import type { Tool, ToolResult, ToolExecutionOptions } from './tool.interface.js';
import { ToolExecutor } from './tool-executor.js';

const BINARY = 'smscli';
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_OTP_PATTERN = '\\d{6}';

export interface WaitForOtpOptions {
  sender?: string;
  timeout?: number;   // how long to wait for an SMS to arrive (ms)
  pattern?: string;   // regex to extract OTP from message body
}

/**
 * Build a flat argv array from a Record<string, string>.
 * Each key becomes `--key` and the value follows as a separate token.
 */
function buildFlags(args: Record<string, string>): string[] {
  const flags: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    flags.push(`--${key}`, value);
  }
  return flags;
}

/**
 * Try to extract the OTP code from raw stdout using a regex pattern.
 * Returns the first capture group if present, otherwise the first full match.
 */
function extractOtp(raw: string, pattern: string): string | null {
  try {
    const re = new RegExp(pattern);
    const match = raw.match(re);
    if (!match) return null;
    // Prefer the first capture group when the pattern defines one.
    return match[1] ?? match[0];
  } catch {
    return null;
  }
}

export class SmscliAdapter implements Tool {
  readonly name = 'smscli';

  constructor(
    private readonly executor: ToolExecutor,
    private readonly config?: Record<string, string>,
  ) {}

  /**
   * Generic dispatch:
   *   execute("get-otp",  { sender: "MyBank", pattern: "\\d{6}" })
   *     → smscli get-otp --sender "MyBank" --pattern "\\d{6}"
   *
   *   execute("list", { sender: "MyBank", limit: "5" })
   *     → smscli list --sender "MyBank" --limit 5
   */
  async execute(
    command: string,
    args: Record<string, string>,
    options?: ToolExecutionOptions,
  ): Promise<ToolResult> {
    const argv = [command, ...buildFlags(args)];
    let result: Awaited<ReturnType<ToolExecutor['run']>>;

    try {
      result = await this.executor.run(BINARY, argv, options);
    } catch (err) {
      return {
        success: false,
        output: '',
        error: (err as Error).message,
      };
    }

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: '',
        raw: result.stdout,
        error: result.stderr.trim() || `smscli exited with code ${result.exitCode}`,
      };
    }

    const raw = result.stdout.trim();

    // For get-otp commands, try to extract the code automatically.
    if (command === 'get-otp') {
      const pattern = args['pattern'] ?? DEFAULT_OTP_PATTERN;
      const otp = extractOtp(raw, pattern);
      if (otp) {
        return { success: true, output: otp, raw };
      }
      // smscli succeeded but produced output we cannot parse — return raw.
      return { success: true, output: raw, raw };
    }

    return { success: true, output: raw, raw };
  }

  /**
   * Poll smscli until an OTP matching `pattern` arrives or `timeout` elapses.
   *
   * Strategy: call `smscli get-otp [--sender <sender>] [--pattern <pattern>]`
   * every POLL_INTERVAL_MS.  If the command returns a non-zero exit code (no
   * message yet) we wait and retry.  If it succeeds, we return the extracted
   * code immediately.
   */
  async waitForOtp(options: WaitForOtpOptions = {}): Promise<ToolResult> {
    const {
      sender,
      timeout = DEFAULT_WAIT_TIMEOUT_MS,
      pattern = DEFAULT_OTP_PATTERN,
    } = options;

    const args: Record<string, string> = { pattern };
    if (sender) args['sender'] = sender;

    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const result = await this.execute('get-otp', args, { timeout });

      if (result.success && result.output) {
        return result;
      }

      // Not yet available — wait before retrying.
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      await sleep(Math.min(POLL_INTERVAL_MS, remaining));
    }

    return {
      success: false,
      output: '',
      error: `Timed out waiting for OTP after ${timeout}ms${sender ? ` from sender '${sender}'` : ''}.`,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
