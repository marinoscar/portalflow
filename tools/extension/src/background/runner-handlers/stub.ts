import type { RunnerError } from '../../shared/runner-protocol';

/**
 * Returns a not_implemented RunnerError for a given commandId.
 * Task 6 replaces calls to this with real handler dispatch.
 */
export function notImplemented(commandId: string): RunnerError {
  return {
    kind: 'result',
    commandId,
    ok: false,
    message: 'not_implemented',
    code: 'not_implemented',
    recoverable: false,
  };
}
