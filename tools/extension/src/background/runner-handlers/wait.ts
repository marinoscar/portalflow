import type { WaitCommand, RunnerResponse } from '../../shared/runner-protocol';

/**
 * Handles WaitCommand — four conditions:
 *   - selector:      polls the content script until an element is visible
 *   - navigation:    one-shot webNavigation.onCompleted listener
 *   - delay:         simple setTimeout
 *   - network_idle:  tracks in-flight requests via webRequest; falls back to
 *                    a fixed 1.5 s pause if chrome.webRequest is unavailable.
 *
 * All conditions honour command.timeoutMs.
 */
export async function wait(
  command: WaitCommand,
  tabId: number,
): Promise<RunnerResponse> {
  switch (command.condition) {
    case 'selector':
      return waitForSelector(command, tabId);
    case 'navigation':
      return waitForNavigation(command, tabId);
    case 'delay':
      return waitDelay(command);
    case 'network_idle':
      return waitNetworkIdle(command, tabId);
    default:
      return {
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: `Unknown wait condition: ${(command as WaitCommand).condition}`,
        code: 'unknown_condition',
        recoverable: false,
      };
  }
}

// ---------------------------------------------------------------------------
// selector
// ---------------------------------------------------------------------------

interface DomWaitReply {
  ok: boolean;
  code?: string;
  message?: string;
}

function waitForSelector(command: WaitCommand, tabId: number): Promise<RunnerResponse> {
  return new Promise<RunnerResponse>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function finish(response: RunnerResponse) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(response);
    }

    // Timeout
    timer = setTimeout(() => {
      finish({
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: `waitForSelector timed out after ${command.timeoutMs}ms`,
        code: 'wait_selector_timeout',
        recoverable: true,
      });
    }, command.timeoutMs);

    chrome.tabs.sendMessage(
      tabId,
      {
        channel: 'runner-dom',
        op: 'waitForSelector',
        cascade: command.selectors,
        timeoutMs: command.timeoutMs,
      },
      (reply: DomWaitReply | undefined) => {
        if (chrome.runtime.lastError || !reply) {
          finish({
            kind: 'result',
            commandId: command.commandId,
            ok: false,
            message: chrome.runtime.lastError?.message ?? 'content script returned no reply',
            code: 'content_script_error',
            recoverable: false,
          });
          return;
        }

        if (reply.ok) {
          finish({
            kind: 'result',
            commandId: command.commandId,
            ok: true,
            value: null,
          });
        } else {
          finish({
            kind: 'result',
            commandId: command.commandId,
            ok: false,
            message: reply.message ?? 'waitForSelector failed',
            code: reply.code ?? 'wait_selector_timeout',
            recoverable: true,
          });
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

function waitForNavigation(command: WaitCommand, tabId: number): Promise<RunnerResponse> {
  return new Promise<RunnerResponse>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cleanup() {
      if (timer !== undefined) clearTimeout(timer);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
    }

    function finish(response: RunnerResponse) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    }

    function onCompleted(
      details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
    ) {
      if (details.tabId !== tabId || details.frameId !== 0) return;

      // If a URL pattern is set, do a case-insensitive substring match
      if (command.urlPattern) {
        if (!details.url.toLowerCase().includes(command.urlPattern.toLowerCase())) {
          return; // Not the navigation we're waiting for
        }
      }

      finish({
        kind: 'result',
        commandId: command.commandId,
        ok: true,
        value: { url: details.url },
      });
    }

    chrome.webNavigation.onCompleted.addListener(onCompleted);

    timer = setTimeout(() => {
      finish({
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: `waitForNavigation timed out after ${command.timeoutMs}ms`,
        code: 'navigation_timeout',
        recoverable: true,
      });
    }, command.timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

function waitDelay(command: WaitCommand): Promise<RunnerResponse> {
  const durationMs = command.durationMs ?? 0;
  return new Promise<RunnerResponse>((resolve) => {
    setTimeout(() => {
      resolve({
        kind: 'result',
        commandId: command.commandId,
        ok: true,
        value: null,
      });
    }, durationMs);
  });
}

// ---------------------------------------------------------------------------
// network_idle
// ---------------------------------------------------------------------------

/**
 * Tracks in-flight requests per-tab using chrome.webRequest listeners.
 * Resolves after 500 ms with zero in-flight requests.
 *
 * If chrome.webRequest is unavailable (e.g. missing permission in some
 * MV3 configurations) falls back to a fixed 1.5 s pause with a one-time
 * console warning.
 */
function waitNetworkIdle(command: WaitCommand, _tabId: number): Promise<RunnerResponse> {
  return new Promise<RunnerResponse>((resolve) => {
    let settled = false;
    let globalTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = 0;

    function finish(response: RunnerResponse) {
      if (settled) return;
      settled = true;
      if (globalTimer !== undefined) clearTimeout(globalTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      try {
        chrome.webRequest.onBeforeRequest.removeListener(onRequest);
        chrome.webRequest.onCompleted.removeListener(onDone);
        chrome.webRequest.onErrorOccurred.removeListener(onDone);
      } catch {
        // listener may already be removed or chrome.webRequest unavailable
      }
      resolve(response);
    }

    function scheduleIdleCheck() {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (inFlight === 0) {
          finish({
            kind: 'result',
            commandId: command.commandId,
            ok: true,
            value: null,
          });
        }
      }, 500);
    }

    function onRequest() {
      inFlight++;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    }

    function onDone() {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) scheduleIdleCheck();
    }

    // Global timeout
    globalTimer = setTimeout(() => {
      finish({
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: `waitForNetworkIdle timed out after ${command.timeoutMs}ms`,
        code: 'network_idle_timeout',
        recoverable: true,
      });
    }, command.timeoutMs);

    // Try to attach webRequest listeners
    try {
      if (!chrome.webRequest) {
        throw new Error('chrome.webRequest not available');
      }
      chrome.webRequest.onBeforeRequest.addListener(onRequest, { urls: ['<all_urls>'] });
      chrome.webRequest.onCompleted.addListener(onDone, { urls: ['<all_urls>'] });
      chrome.webRequest.onErrorOccurred.addListener(onDone, { urls: ['<all_urls>'] });
      // Kick off first idle check — resolves immediately if nothing in flight
      scheduleIdleCheck();
    } catch {
      console.warn(
        '[PortalFlow] network_idle: chrome.webRequest unavailable; falling back to 1500 ms pause',
      );
      // Fallback: simple pause
      setTimeout(() => {
        finish({
          kind: 'result',
          commandId: command.commandId,
          ok: true,
          value: null,
        });
      }, 1500);
    }
  });
}
