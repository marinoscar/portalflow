import pino from 'pino';
import { join } from 'node:path';
import type { LogLevel, LoggingConfig } from '../config/config.service.js';
import { PORTALFLOW_HOME } from './paths.js';

/**
 * Log level precedence, highest priority first:
 *   1. CLI flag  --log-level   (passed as `cliLevel`)
 *   2. Env var   LOG_LEVEL
 *   3. Config    logging.level
 *   4. Default   "info"
 *
 * File output, pretty printing, and secret redaction follow the same
 * precedence pattern (CLI/env > config > defaults), except that they
 * lack CLI flags today and fall through to the config value.
 */
export interface ResolvedLoggingConfig {
  level: LogLevel;
  file?: string;
  pretty: boolean;
  redactSecrets: boolean;
  /**
   * When `true`, stdout is owned by the RunPresenter and pino must NOT
   * write to stdout. The logger returned in this mode writes to the
   * file (from `file`, or a per-run default path) and nothing else.
   * Set by AutomationRunner when the caller hasn't opted into
   * `--verbose`.
   */
  fileOnly?: boolean;
}

/**
 * Pick a default log file path for runs where the user hasn't
 * configured one explicitly. Lives under ~/.portalflow/logs/ and is
 * timestamp-stamped per run so presenter mode always has a concrete
 * path to point at ("log: …") regardless of config state.
 */
export function defaultLogFilePath(automationName: string): string {
  const slug = (automationName || 'run')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'run';
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/Z$/, '');
  return join(PORTALFLOW_HOME, 'logs', `${slug}-${ts}.log`);
}

const VALID_LEVELS: LogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
];

function isValidLevel(value: string | undefined): value is LogLevel {
  return !!value && VALID_LEVELS.includes(value as LogLevel);
}

export function resolveLoggingConfig(
  stored: LoggingConfig | undefined,
  cliLevel?: string,
): ResolvedLoggingConfig {
  const envLevel = process.env['LOG_LEVEL'];
  const level: LogLevel = isValidLevel(cliLevel)
    ? cliLevel
    : isValidLevel(envLevel)
      ? envLevel
      : isValidLevel(stored?.level)
        ? stored!.level!
        : 'info';

  return {
    level,
    file: stored?.file && stored.file.trim().length > 0 ? stored.file : undefined,
    pretty: stored?.pretty ?? true,
    redactSecrets: stored?.redactSecrets ?? true,
  };
}

/**
 * Redaction paths applied when `redactSecrets` is true. Any logged object
 * that has one of these property paths will see that property replaced
 * with "[REDACTED]" before the log line is written. The goal is to
 * protect credentials pulled from vaultcli, OTPs, and any property
 * containing "password", "secret", "apiKey", or "token" in nested
 * structured logs.
 *
 * Pino applies redaction by JSON path — exact match, not substring. So
 * we list common shapes the runner actually uses when logging resolved
 * tool args, input resolution events, and chat completions.
 */
const REDACT_PATHS = [
  'apiKey',
  'password',
  'secret',
  'token',
  'otp',
  'otpCode',
  '*.apiKey',
  '*.password',
  '*.secret',
  '*.token',
  '*.otp',
  '*.otpCode',
  'args.password',
  'args.secret',
  'args.token',
  'args.otp',
  'args.apiKey',
  'resolvedArgs.password',
  'resolvedArgs.secret',
  'resolvedArgs.apiKey',
  'resolvedArgs.token',
  'resolvedArgs.otp',
];

/**
 * Build a pino logger for a single automation run.
 *
 * When `config.file` is set, logs are fanned out to BOTH stdout (pretty
 * or JSON depending on `config.pretty`) and the file (always JSON, one
 * entry per line — easier for grep and machine processing).
 *
 * Secret redaction is applied to both targets when `config.redactSecrets`
 * is true.
 */
export function createRunLogger(
  automationName: string,
  config?: ResolvedLoggingConfig,
): pino.Logger {
  const resolved: ResolvedLoggingConfig = config ?? resolveLoggingConfig(undefined);

  const pinoOptions: pino.LoggerOptions = {
    name: `portalflow:${automationName}`,
    level: resolved.level,
  };

  if (resolved.redactSecrets) {
    pinoOptions.redact = {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    };
  }

  // File-only mode: stdout is owned by the RunPresenter. The logger
  // must NOT write anything to stdout or stderr; all events go to the
  // configured file (raw JSON, one entry per line). Caller guarantees
  // `resolved.file` is set when `fileOnly` is true.
  if (resolved.fileOnly && resolved.file) {
    try {
      return pino(
        pinoOptions,
        pino.destination({ dest: resolved.file, sync: false, mkdir: true }),
      );
    } catch {
      // Destination setup failed. Fall through to a silent logger so
      // presenter mode is never broken by a file-permission error.
      return pino({ ...pinoOptions, level: 'silent' });
    }
  }

  // If no file is configured, use a single stdout transport. Otherwise
  // use a multi-transport fan-out to stdout + file.
  if (!resolved.file) {
    try {
      return pino({
        ...pinoOptions,
        transport: resolved.pretty
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
          : undefined,
      });
    } catch {
      // pino-pretty unavailable in this environment — fall back to raw JSON
      return pino(pinoOptions);
    }
  }

  try {
    return pino({
      ...pinoOptions,
      transport: {
        targets: [
          resolved.pretty
            ? {
                target: 'pino-pretty',
                level: resolved.level,
                options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
              }
            : {
                target: 'pino/file',
                level: resolved.level,
                options: { destination: 1 }, // stdout
              },
          {
            target: 'pino/file',
            level: resolved.level,
            options: { destination: resolved.file, mkdir: true, append: true },
          },
        ],
      },
    });
  } catch {
    // Multi-transport setup failed (e.g. pino-pretty missing). Fall back to
    // a file-only transport so the user still gets the file they asked for.
    return pino(
      pinoOptions,
      pino.destination({ dest: resolved.file, sync: false, mkdir: true }),
    );
  }
}
