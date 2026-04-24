/**
 * Process exit codes emitted by the portalflow CLI.
 *
 * Agents that shell out to portalflow (OpenClaw, opencode, Claude Code, etc.)
 * read exit codes to decide how to react. Collapsing every failure to `1`
 * forces callers to parse error text; distinguishing the common failure
 * modes lets them retry, prompt for credentials, or surface a targeted
 * error without string-sniffing stderr.
 *
 * The wire contract (keep stable across minor versions):
 *
 *   0 — Ok         — the run succeeded
 *   1 — Runtime    — unexpected runtime error, user input error, or generic failure
 *   2 — Schema     — automation JSON failed schema validation
 *   3 — Auth       — LLM provider / auth pre-flight or runtime auth failure
 *   4 — Extension  — Chrome launch or extension handshake failure
 */
export const ExitCodes = {
  Ok: 0,
  Runtime: 1,
  Schema: 2,
  Auth: 3,
  Extension: 4,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

/**
 * Map an arbitrary thrown error to the most specific exit code based on its
 * message. Falls back to Runtime for anything unrecognised. Matching is
 * deliberately narrow — the goal is "I can recognise this class of failure",
 * not "I can categorise every possible error".
 */
export function exitCodeForError(err: unknown): ExitCode {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /^LLM (connectivity|pre-flight) check failed/i.test(msg) ||
    /^LLM pre-flight failed/i.test(msg)
  ) {
    return ExitCodes.Auth;
  }
  if (
    /^Chrome \/ extension handshake failed/i.test(msg) ||
    /^Failed to open automation run window/i.test(msg)
  ) {
    return ExitCodes.Extension;
  }
  return ExitCodes.Runtime;
}

/**
 * Write `message` (if provided) to stderr with a trailing newline, then
 * `process.exit(code)`. Never returns.
 */
export function exitWith(code: ExitCode, message?: string): never {
  if (message !== undefined) {
    const text = message.endsWith('\n') ? message : message + '\n';
    process.stderr.write(text);
  }
  process.exit(code);
}
