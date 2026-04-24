import type { Tool, ToolResult, ToolExecutionOptions, ToolDescription } from './tool.interface.js';
import { ToolExecutor } from './tool-executor.js';

const BINARY = 'vaultcli';

// Envelope returned by `vaultcli secrets get <name> --json`.
//
//   { "success": true,
//     "data": {
//       "id": "…", "name": "att", "updatedAt": "…",
//       "values": { "username": "…", "password": "…", "url": "…" }
//     } }
//
// On failure:
//
//   { "success": false, "error": "Secret not found", "code": "NOT_FOUND" }
interface VaultEnvelope {
  success: boolean;
  data?: {
    id?: string;
    name?: string;
    updatedAt?: string;
    values?: Record<string, unknown>;
  };
  error?: string;
  code?: string;
}

function parseEnvelope(raw: string): VaultEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as VaultEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeCommand(command: string): 'secrets-get' | null {
  const c = command.trim().toLowerCase();
  if (c === 'secrets-get' || c === 'secrets get' || c === 'get' || c === 'secrets_get') {
    return 'secrets-get';
  }
  return null;
}

function stringifyValues(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

export class VaultcliAdapter implements Tool {
  readonly name = 'vaultcli';

  constructor(
    private readonly executor: ToolExecutor,
    // Reserved for future per-adapter config (server URL, etc.). Unused today
    // but kept in the signature so callers can pass config without breaking.
    _config?: Record<string, string>,
  ) {
    void _config;
  }

  /**
   * Returns the LLM-facing description of this tool. Matches the actual
   * adapter contract exactly — no narrowing needed for vaultcli.
   */
  describe(): ToolDescription {
    return {
      tool: 'vaultcli',
      description: 'Retrieves secrets from the local vault.',
      commands: [
        {
          command: 'secrets-get',
          description: 'Fetches a secret by name. Returns all fields or a single field.',
          args: [
            {
              name: 'name',
              required: true,
              description: 'The name of the secret to retrieve.',
            },
            {
              name: 'field',
              required: false,
              description:
                'If provided, returns only this field from the secret (e.g. "password").',
            },
          ],
          resultDescription:
            'The secret value(s). Stored as vaultcli_secrets_get_result.',
        },
      ],
    };
  }

  /**
   * Only one command is supported:
   *
   *   execute("secrets-get", { name: "att" })
   *     → vaultcli secrets get "att" --json
   *     → returns { success, output: JSON(values), fields: values }
   *
   *   execute("secrets-get", { name: "att", field: "password" })
   *     → vaultcli secrets get "att" --json
   *     → returns { success, output: values.password }   (no fields)
   */
  async execute(
    command: string,
    args: Record<string, string>,
    options?: ToolExecutionOptions,
  ): Promise<ToolResult> {
    const normalized = normalizeCommand(command);
    if (normalized !== 'secrets-get') {
      return {
        success: false,
        output: '',
        error: `Unknown vaultcli command "${command}". Valid: secrets-get`,
      };
    }

    const name = args['name'];
    if (!name || name.trim().length === 0) {
      return {
        success: false,
        output: '',
        error: 'vaultcli secrets-get requires an "name" arg (the secret name).',
      };
    }

    const argv = ['secrets', 'get', name, '--json'];

    let result: Awaited<ReturnType<ToolExecutor['run']>>;
    try {
      result = await this.executor.run(BINARY, argv, options);
    } catch (err) {
      const msg = (err as Error).message;
      return { success: false, output: '', error: msg };
    }

    const raw = result.stdout.trim();
    const envelope = parseEnvelope(raw);

    if (!envelope) {
      const stderr = result.stderr.trim();
      return {
        success: false,
        output: '',
        raw,
        error:
          stderr ||
          `vaultcli did not return valid JSON for secret "${name}" (exit=${result.exitCode}).`,
      };
    }

    if (envelope.success === false) {
      const errorText = envelope.error ?? 'unknown vaultcli error';
      const code = envelope.code ? ` (${envelope.code})` : '';
      return {
        success: false,
        output: '',
        raw,
        error: `vaultcli: ${errorText}${code}`,
      };
    }

    const values = envelope.data?.values;
    if (!values || typeof values !== 'object') {
      return {
        success: false,
        output: '',
        raw,
        error: `vaultcli secret "${name}" returned no values object.`,
      };
    }

    const fields = stringifyValues(values);

    // Single-field mode — caller asked for just one value.
    const field = args['field'];
    if (field && field.trim().length > 0) {
      if (!(field in fields)) {
        return {
          success: false,
          output: '',
          raw,
          error: `vaultcli: field "${field}" not in secret "${name}". Available: ${Object.keys(fields).join(', ') || '(none)'}`,
        };
      }
      return { success: true, output: fields[field]!, raw };
    }

    // Multi-field mode — return the whole values map so the runner can
    // explode every key into its own context variable.
    return {
      success: true,
      output: JSON.stringify(fields),
      fields,
      raw,
    };
  }
}
