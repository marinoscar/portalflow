import type { NavigateCommand, RunnerResponse } from '../../shared/runner-protocol';

/**
 * Navigates the given tab to the specified URL and waits for the main-frame
 * navigation to complete (webNavigation.onCompleted).
 *
 * If the navigation does not complete within command.timeoutMs milliseconds,
 * returns an error with code 'navigate_timeout'.
 */
export async function navigate(
  command: NavigateCommand,
  tabId: number,
): Promise<RunnerResponse> {
  return new Promise<RunnerResponse>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    function cleanup() {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
    }

    function onCompleted(details: chrome.webNavigation.WebNavigationFramedCallbackDetails) {
      // Only care about the main frame of our tab
      if (details.tabId !== tabId || details.frameId !== 0) return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        kind: 'result',
        commandId: command.commandId,
        ok: true,
        value: { url: details.url },
      });
    }

    chrome.webNavigation.onCompleted.addListener(onCompleted);

    // Start the navigation
    chrome.tabs.update(tabId, { url: command.url }).catch((err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        code: 'navigate_error',
        recoverable: false,
      });
    });

    // Enforce timeout
    timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: `Navigation to ${command.url} timed out after ${command.timeoutMs}ms`,
        code: 'navigate_timeout',
        recoverable: true,
      });
    }, command.timeoutMs);
  });
}
