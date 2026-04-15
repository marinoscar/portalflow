import type { ScreenshotCommand, RunnerResponse } from '../../shared/runner-protocol';

/**
 * Captures a screenshot of the visible area in the tab's window using
 * chrome.tabs.captureVisibleTab.
 *
 * Returns {ok: true, value: {dataUrl: 'data:image/png;base64,...'}}.
 * The CLI side is responsible for decoding the dataUrl and writing the file.
 *
 * Limitations:
 * - captureVisibleTab only captures the currently visible portion of the page.
 * - The tab's window must be in a usable state (not a chrome:// page).
 * - The activeTab or <all_urls> host permission is required (both present).
 */
export async function screenshot(
  command: ScreenshotCommand,
  tabId: number,
): Promise<RunnerResponse> {
  // Resolve the windowId for the given tab
  let windowId: number;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId === undefined) {
      throw new Error('tab has no windowId');
    }
    windowId = tab.windowId;
  } catch (err) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 'screenshot_failed',
      recoverable: false,
    };
  }

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 'screenshot_failed',
      recoverable: false,
    };
  }

  return {
    kind: 'result',
    commandId: command.commandId,
    ok: true,
    value: { dataUrl },
  };
}
