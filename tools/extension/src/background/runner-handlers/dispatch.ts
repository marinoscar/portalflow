import type { RunnerCommand, RunnerResponse } from '../../shared/runner-protocol';
import { notImplemented } from './stub';
import { navigate } from './navigate';
import { click } from './click';
import { type as typeText } from './type';
import { extract } from './extract';
import { wait } from './wait';
import { countMatching } from './count-matching';
import { anyMatch } from './any-match';
import { scroll } from './scroll';
import { download } from './download';
import { screenshot } from './screenshot';
import {
  select,
  check,
  uncheck,
  hover,
  focus,
} from './interact-extended';
import { handleOpenWindow } from './open-window';
import { handleCloseWindow } from './close-window';
import { clearBrowsingData } from './clear-browsing-data';
import { getRunTabId } from '../run-window';

// ---------------------------------------------------------------------------
// Active-tab helper
// ---------------------------------------------------------------------------

/**
 * Resolves the tab id to use for the current command.
 *
 * Priority order:
 *  1. If a dedicated run window is active (`getRunTabId()` returns non-null),
 *     use that tab — this is the correct path for all production runs.
 *  2. Fall back to querying the active tab in the focused window. This path
 *     supports bare-bones runs that never call `openWindow` (e.g. the
 *     task-6/7 integration tests). A debug-level warning is logged when the
 *     fallback is taken so it is visible in verbose mode.
 */
async function withActiveTab<T>(cb: (tabId: number) => Promise<T>): Promise<T> {
  const runTabId = getRunTabId();
  if (runTabId !== null) {
    return cb(runTabId);
  }

  // Fallback: no run window is open — query the focused window's active tab.
  console.debug(
    '[dispatch] withActiveTab: no run window active, falling back to chrome.tabs.query — ' +
    'call openWindow before running automation steps for reliable tab targeting',
  );

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

        case 'select':
          return withActiveTab((tabId) => select(command, tabId)).catch((err) => ({
            kind: 'result' as const,
            commandId: command.commandId,
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
            code: 'tab_not_found',
            recoverable: false,
          }));

        case 'check':
          return withActiveTab((tabId) => check(command, tabId)).catch((err) => ({
            kind: 'result' as const,
            commandId: command.commandId,
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
            code: 'tab_not_found',
            recoverable: false,
          }));

        case 'uncheck':
          return withActiveTab((tabId) => uncheck(command, tabId)).catch((err) => ({
            kind: 'result' as const,
            commandId: command.commandId,
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
            code: 'tab_not_found',
            recoverable: false,
          }));

        case 'hover':
          return withActiveTab((tabId) => hover(command, tabId)).catch((err) => ({
            kind: 'result' as const,
            commandId: command.commandId,
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
            code: 'tab_not_found',
            recoverable: false,
          }));

        case 'focus':
          return withActiveTab((tabId) => focus(command, tabId)).catch((err) => ({
            kind: 'result' as const,
            commandId: command.commandId,
            ok: false as const,
            message: err instanceof Error ? err.message : String(err),
            code: 'tab_not_found',
            recoverable: false,
          }));

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

    case 'wait':
      return withActiveTab((tabId) => wait(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    case 'countMatching':
      return withActiveTab((tabId) => countMatching(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    case 'anyMatch':
      return withActiveTab((tabId) => anyMatch(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    case 'scroll':
      return withActiveTab((tabId) => scroll(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    case 'download':
      return withActiveTab((tabId) => download(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    case 'screenshot':
      return withActiveTab((tabId) => screenshot(command, tabId)).catch((err) => ({
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
        code: 'tab_not_found',
        recoverable: false,
      }));

    case 'openWindow':
      return handleOpenWindow(command);

    case 'closeWindow':
      return handleCloseWindow(command);

    case 'clearBrowsingData':
      return withActiveTab((tabId) => clearBrowsingData(command, tabId));

    default:
      return notImplemented((command as { commandId: string }).commandId);
  }
}
