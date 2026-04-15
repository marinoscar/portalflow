import type { CloseWindowCommand, RunnerResponse } from '../../shared/runner-protocol';
import { closeRunWindow } from '../run-window';

/**
 * Handles the closeWindow command.
 * Closes the tracked run window (or no-ops if it no longer exists).
 */
export async function handleCloseWindow(command: CloseWindowCommand): Promise<RunnerResponse> {
  try {
    await closeRunWindow(command.windowId);
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: true,
      value: null,
    };
  } catch (err: unknown) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 'close_window_failed',
      recoverable: false,
    };
  }
}
