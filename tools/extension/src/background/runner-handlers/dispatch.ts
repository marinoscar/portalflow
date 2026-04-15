import type { RunnerCommand, RunnerResponse } from '../../shared/runner-protocol';
import { notImplemented } from './stub';
import { navigate } from './navigate';
import { click } from './click';
import { type as typeText } from './type';
import { extract } from './extract';

// ---------------------------------------------------------------------------
// Active-tab helper (task-6 simplification)
// ---------------------------------------------------------------------------

/**
 * Resolves the active tab in the current focused window.
 *
 * TASK-6 SIMPLIFICATION: This queries whatever tab is active in the user's
 * focused window. Task 9 will replace this with dedicated run-window
 * bookkeeping (a stored windowId returned by openWindow) so that automation
 * targets the correct window even when the user focuses another.
 */
async function withActiveTab<T>(cb: (tabId: number) => Promise<T>): Promise<T> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    throw new Error('no active tab found in the current window');
  }
  return cb(tab.id);
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

/**
 * Central dispatch table for runner commands.
 * Replaces the stub body in runner-bootstrap.ts.
 * Unrecognised commands and unimplemented variants return notImplemented().
 */
export async function handleRunnerCommand(
  command: RunnerCommand,
): Promise<RunnerResponse> {
  switch (command.type) {
    case 'navigate':
      return withActiveTab((tabId) => navigate(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    case 'interact': {
      switch (command.action) {
        case 'click':
          return withActiveTab((tabId) => click(command, tabId)).catch((err) => ({
            kind: 'result' as const,
            commandId: command.commandId,
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
            code: 'tab_not_found',
            recoverable: false,
          }));

        case 'type':
          return withActiveTab((tabId) => typeText(command, tabId)).catch((err) => ({
            kind: 'result' as const,
            commandId: command.commandId,
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
            code: 'tab_not_found',
            recoverable: false,
          }));

        // Remaining interact actions deferred to task 8
        default:
          return notImplemented(command.commandId);
      }
    }

    case 'extract':
      return withActiveTab((tabId) => extract(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    // Commands deferred to later tasks
    case 'wait':
    case 'download':
    case 'screenshot':
    case 'countMatching':
    case 'anyMatch':
    case 'scroll':
    case 'openWindow':
    case 'closeWindow':
    default:
      return notImplemented(command.commandId);
  }
}
