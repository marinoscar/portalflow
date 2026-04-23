import type { Tool, ToolResult, ToolExecutionOptions } from './tool.interface.js';
import { ToolExecutor } from './tool-executor.js';

const BINARY = 'smscli';
const DEFAULT_TIMEOUT_SECONDS = 60;

// Envelope returned by `smscli otp wait/latest/extract --json`.
//
// Success:
//   { "success": true,
//     "data": {
//       "code": "483921",
//       "sender": "MyBank Alerts",
//       "body": "Your verification code is 483921",
//       "smsTimestamp": "…",
//       "receivedAt": "…",
//       "messageId": "…"
//     } }
//
// Timeout (wait-only):
//   { "success": false, "error": "No OTP found within timeout", "code": "OTP_TIMEOUT" }
//
// Other failures:
//   { "success": false, "error": "Unauthorized", "code": "AUTH_ERROR" }
interface SmsEnvelope {
  success: boolean;
  data?: {
    code?: string;
    sender?: string;
    body?: string;
    smsTimestamp?: string;
    receivedAt?: string;
    messageId?: string;
  };
  error?: string;
  code?: string;
}

function parseEnvelope(raw: string): SmsEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SmsEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

type Normalized = 'otp-wait' | 'otp-latest' | 'otp-extract' | null;

function normalizeCommand(command: string): Normalized {
  const c = command.trim().toLowerCase();
  if (c === 'otp-wait' || c === 'wait' || c === 'otp wait') return 'otp-wait';
  if (c === 'otp-latest' || c === 'latest' || c === 'otp latest') return 'otp-latest';
  if (c === 'otp-extract' || c === 'extract' || c === 'otp extract') return 'otp-extract';
  return null;
}

// Shared filter args used by wait and latest.
const FILTER_KEYS = ['sender', 'since', 'device', 'number'] as const;

function pickFilterArgv(args: Record<string, string>): string[] {
  const argv: string[] = [];
  for (const key of FILTER_KEYS) {
    const v = args[key];
    if (v !== undefined && v !== '') {
      argv.push(`--${key}`, v);
    }
  }
  return argv;
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_SECONDS;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) return DEFAULT_TIMEOUT_SECONDS;
  return n;
}

export class SmscliAdapter implements Tool {
  readonly name = 'smscli';

  constructor(
    private readonly executor: ToolExecutor,
    _config?: Record<string, string>,
  ) {
    void _config;
  }

  /**
   * Supported commands:
   *
   *   otp-wait   — `smscli otp wait --json [--timeout N --sender X ...]`
   *                On OTP_TIMEOUT, automatically falls back to `otp latest`
   *                with the same filter args.
   *
   *   otp-latest — `smscli otp latest --json [--sender X ...]`
   *                No fallback.
   *
   *   otp-extract — `smscli otp extract --message "<text>" --json`
   *                Offline extraction from a literal body.
   */
  async execute(
    command: string,
    args: Record<string, string>,
    options?: ToolExecutionOptions,
  ): Promise<ToolResult> {
    const normalized = normalizeCommand(command);
    if (normalized === null) {
      return {
        success: false,
        output: '',
        error: `Unknown smscli command "${command}". Valid: otp-wait, otp-latest, otp-extract`,
      };
    }

    switch (normalized) {
      case 'otp-wait':
        return this.runWaitWithFallback(args, options);
      case 'otp-latest':
        return this.runLatest(args, options);
      case 'otp-extract':
        return this.runExtract(args, options);
    }
  }

  private async runWaitWithFallback(
    args: Record<string, string>,
    options?: ToolExecutionOptions,
  ): Promise<ToolResult> {
    const timeoutSec = parseTimeout(args['timeout']);
    const filters = pickFilterArgv(args);
    const waitArgv = ['otp', 'wait', '--json', '--timeout', String(timeoutSec), ...filters];

    const waitResult = await this.runEnvelope(waitArgv, options);

    if (waitResult.success === 'ok') {
      return envelopeToResult(waitResult.envelope, waitResult.raw);
    }

    if (waitResult.success === 'timeout') {
      // Automatic fallback to `otp latest` with the same filters.
      const latestArgv = ['otp', 'latest', '--json', ...filters];
      const latestResult = await this.runEnvelope(latestArgv, options);

      if (latestResult.success === 'ok') {
        return envelopeToResult(latestResult.envelope, latestResult.raw);
      }

      let fallbackError: string;
      if (latestResult.success === 'err' || latestResult.success === 'timeout') {
        fallbackError = envelopeErrorText(latestResult.envelope) ?? 'latest returned no data';
      } else {
        // spawn
        fallbackError = latestResult.error;
      }

      return {
        success: false,
        output: '',
        raw: latestResult.raw,
        error: `smscli: otp wait timed out after ${timeoutSec}s and otp latest also returned nothing (${fallbackError})`,
      };
    }

    if (waitResult.success === 'err') {
      return {
        success: false,
        output: '',
        raw: waitResult.raw,
        error: `smscli: ${envelopeErrorText(waitResult.envelope) ?? 'wait failed'}`,
      };
    }

    // spawn error
    return {
      success: false,
      output: '',
      raw: waitResult.raw,
      error: waitResult.error,
    };
  }

  private async runLatest(
    args: Record<string, string>,
    options?: ToolExecutionOptions,
  ): Promise<ToolResult> {
    const filters = pickFilterArgv(args);
    const argv = ['otp', 'latest', '--json', ...filters];
    const result = await this.runEnvelope(argv, options);

    if (result.success === 'ok') {
      return envelopeToResult(result.envelope, result.raw);
    }
    if (result.success === 'err' || result.success === 'timeout') {
      return {
        success: false,
        output: '',
        raw: result.raw,
        error: `smscli: ${envelopeErrorText(result.envelope) ?? 'latest failed'}`,
      };
    }
    return {
      success: false,
      output: '',
      raw: result.raw,
      error: result.error,
    };
  }

  private async runExtract(
    args: Record<string, string>,
    options?: ToolExecutionOptions,
  ): Promise<ToolResult> {
    const message = args['message'];
    if (!message || message.length === 0) {
      return {
        success: false,
        output: '',
        error: 'smscli otp-extract requires a "message" arg (the literal SMS body).',
      };
    }
    const argv = ['otp', 'extract', '--message', message, '--json'];
    const result = await this.runEnvelope(argv, options);

    if (result.success === 'ok') {
      return envelopeToResult(result.envelope, result.raw);
    }
    if (result.success === 'err' || result.success === 'timeout') {
      return {
        success: false,
        output: '',
        raw: result.raw,
        error: `smscli: ${envelopeErrorText(result.envelope) ?? 'extract failed'}`,
      };
    }
    return {
      success: false,
      output: '',
      raw: result.raw,
      error: result.error,
    };
  }

  /**
   * Run an smscli sub-command and classify the result as:
   *   ok      — envelope.success === true
   *   timeout — envelope.success === false AND code === "OTP_TIMEOUT"
   *   err     — envelope.success === false with any other code
   *   spawn   — the binary could not be run or returned unparseable output
   */
  private async runEnvelope(
    argv: string[],
    options?: ToolExecutionOptions,
  ): Promise<
    | { success: 'ok'; envelope: SmsEnvelope; raw: string }
    | { success: 'timeout'; envelope: SmsEnvelope; raw: string }
    | { success: 'err'; envelope: SmsEnvelope; raw: string }
    | { success: 'spawn'; raw: string; error: string }
  > {
    let runResult: Awaited<ReturnType<ToolExecutor['run']>>;
    try {
      runResult = await this.executor.run(BINARY, argv, options);
    } catch (err) {
      return { success: 'spawn', raw: '', error: (err as Error).message };
    }

    const raw = runResult.stdout.trim();
    const envelope = parseEnvelope(raw);

    if (!envelope) {
      const stderr = runResult.stderr.trim();
      return {
        success: 'spawn',
        raw,
        error:
          stderr || `smscli did not return valid JSON (exit=${runResult.exitCode}).`,
      };
    }

    if (envelope.success === true) {
      return { success: 'ok', envelope, raw };
    }

    if (envelope.code === 'OTP_TIMEOUT') {
      return { success: 'timeout', envelope, raw };
    }

    return { success: 'err', envelope, raw };
  }
}

function envelopeToResult(envelope: SmsEnvelope, raw: string): ToolResult {
  const code = envelope.data?.code;
  if (!code) {
    return {
      success: false,
      output: '',
      raw,
      error: 'smscli returned success but no code in the envelope.',
    };
  }
  return { success: true, output: code, raw };
}

function envelopeErrorText(envelope: SmsEnvelope): string | undefined {
  const err = envelope.error;
  const code = envelope.code;
  if (err && code) return `${err} (${code})`;
  return err ?? code;
}
