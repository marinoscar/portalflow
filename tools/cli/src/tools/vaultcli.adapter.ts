import type { Tool, ToolResult, ToolExecutionOptions } from './tool.interface.js';
import { ToolExecutor } from './tool-executor.js';

const BINARY = 'vaultcli';

/**
 * Shape of the JSON that vaultcli writes to stdout.
 *
 * Single-field response:   { "value": "..." }
 * Multi-field response:    { "username": "...", "password": "...", ... }
 */
type VaultPayload = Record<string, string>;

function parseVaultOutput(raw: string): VaultPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as VaultPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export class VaultcliAdapter implements Tool {
  readonly name = 'vaultcli';

  constructor(
    private readonly executor: ToolExecutor,
    private readonly config?: Record<string, string>,
  ) {}

  /**
   * Generic dispatch:
   *   execute("get", { key: "portal/acme-login" })
   *     → vaultcli get "portal/acme-login"
   *
   *   execute("get", { key: "portal/acme-login", field: "password" })
   *     → vaultcli get "portal/acme-login" --field password
   */
  async execute(
    command: string,
    args: Record<string, string>,
    options?: ToolExecutionOptions,
  ): Promise<ToolResult> {
    const argv = buildArgv(command, args);
    let result: Awaited<ReturnType<ToolExecutor['run']>>;

    try {
      result = await this.executor.run(BINARY, argv, options);
    } catch (err) {
      const msg = (err as Error).message;
      // Surface a friendly message when vaultcli is simply not installed.
      const error = msg.includes('not found')
        ? `vaultcli is not installed or not available on PATH. ${msg}`
        : msg;
      return { success: false, output: '', error };
    }

    const raw = result.stdout.trim();

    if (result.exitCode !== 0) {
      const errText = result.stderr.trim() || raw || `vaultcli exited with code ${result.exitCode}`;
      return { success: false, output: '', raw, error: errText };
    }

    // Parse the JSON payload returned by vaultcli.
    const payload = parseVaultOutput(raw);

    if (!payload) {
      // vaultcli succeeded but the output is not valid JSON — return raw.
      return { success: true, output: raw, raw };
    }

    // If a specific field was requested, extract just that field.
    const field = args['field'];
    if (field) {
      const value = payload[field];
      if (value === undefined) {
        return {
          success: false,
          output: '',
          raw,
          error: `Field '${field}' not found in vaultcli response.`,
        };
      }
      return { success: true, output: value, raw };
    }

    // Default: return the canonical "value" field when it exists, otherwise
    // the full JSON so callers can parse further.
    const output = payload['value'] ?? raw;
    return { success: true, output, raw };
  }

  /**
   * Retrieve a single secret value.
   *   getSecret("portal/acme-login") → ToolResult whose .output is the value
   */
  async getSecret(key: string, options?: ToolExecutionOptions): Promise<ToolResult> {
    return this.execute('get', { key }, options);
  }

  /**
   * Retrieve specific fields from a secret and return them as a plain object.
   *   getSecretFields("portal/acme-login", ["username", "password"])
   *     → { username: "alice", password: "s3cr3t" }
   *
   * Throws if any field is missing or if vaultcli returns an error.
   */
  async getSecretFields(
    key: string,
    fields: string[],
    options?: ToolExecutionOptions,
  ): Promise<Record<string, string>> {
    // Fetch the full secret once (no --field flag) to avoid N round-trips.
    const result = await this.execute('get', { key }, options);

    if (!result.success) {
      throw new Error(
        `Failed to retrieve secret '${key}': ${result.error ?? 'unknown error'}`,
      );
    }

    const payload = result.raw ? parseVaultOutput(result.raw) : null;
    if (!payload) {
      throw new Error(
        `vaultcli response for '${key}' is not valid JSON; cannot extract fields.`,
      );
    }

    const output: Record<string, string> = {};
    const missing: string[] = [];

    for (const field of fields) {
      const value = payload[field];
      if (value === undefined) {
        missing.push(field);
      } else {
        output[field] = value;
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing field(s) in vaultcli response for '${key}': ${missing.join(', ')}.`,
      );
    }

    return output;
  }
}

/**
 * Build the argv array for a vaultcli invocation.
 *
 * The `key` argument is always positional; every other entry becomes
 * a `--flag value` pair.
 */
function buildArgv(command: string, args: Record<string, string>): string[] {
  const { key, ...flags } = args;
  const argv: string[] = [command];

  if (key !== undefined) argv.push(key);

  for (const [name, value] of Object.entries(flags)) {
    argv.push(`--${name}`, value);
  }

  return argv;
}
