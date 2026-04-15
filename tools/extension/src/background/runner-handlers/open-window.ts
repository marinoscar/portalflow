import type { OpenWindowCommand, RunnerResponse } from '../../shared/runner-protocol';
import { openRunWindow } from '../run-window';

/**
 * Handles the openWindow command.
 * Opens a new dedicated automation window and returns its ids.
 */
export async function handleOpenWindow(command: OpenWindowCommand): Promise<RunnerResponse> {
  try {
    const { windowId, tabId } = await openRunWindow({ focused: true });
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: true,
      value: { windowId, tabId },
    };
  } catch (err: unknown) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 'open_window_failed',
      recoverable: false,
    };
  }
}
