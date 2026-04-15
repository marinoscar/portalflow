import type { DownloadCommand, RunnerResponse } from '../../shared/runner-protocol';

/**
 * Handles DownloadCommand.
 *
 * Sequence:
 * 1. Register a one-shot chrome.downloads.onCreated listener BEFORE triggering.
 * 2. Trigger the download:
 *    - trigger === 'click': send runner-dom click op to content script
 *    - trigger === 'navigation': call chrome.tabs.update(tabId, {url})
 * 3. Wait for chrome.downloads.onCreated to fire. Because onCreated does not
 *    carry tab context reliably, we assume "the most recent download created
 *    within 5s of the trigger belongs to this run." This is a v1 heuristic
 *    documented below.
 * 4. Watch chrome.downloads.onChanged for state === 'complete' on that downloadId.
 * 5. On completion, return {ok: true, value: {filename, downloadId, bytesReceived}}.
 *    Also emit an unsolicited 'downloadComplete' event if a WebSocket port is
 *    provided (wired up later; for now the event is best-effort via the
 *    broadcast pattern).
 * 6. On timeout, cancel the in-progress download if possible and return an error.
 *
 * Download save-path limitation:
 * Chrome controls the download destination via user preferences. The extension
 * cannot override the save path directly. The `saveDir` field in the command
 * is noted for the CLI to handle (move/rename) after completion. The actual
 * filename returned is Chrome's chosen path.
 *
 * Cross-tab filtering (v1 heuristic):
 * chrome.downloads.onCreated does not carry a tabId field in all Chrome
 * versions, so we cannot reliably scope it to `tabId`. Instead we accept any
 * download created within 5 seconds of the trigger as belonging to this run.
 * If two concurrent automations run (not a supported configuration), they
 * could interfere. This is acceptable for v1.
 */

interface DomReply {
  ok: boolean;
  message?: string;
  code?: string;
}

const DOWNLOAD_CREATED_WINDOW_MS = 5_000;

export function download(
  command: DownloadCommand,
  tabId: number,
): Promise<RunnerResponse> {
  return new Promise<RunnerResponse>((resolve) => {
    let settled = false;
    let downloadId: number | undefined;
    let globalTimer: ReturnType<typeof setTimeout> | undefined;
    let createdTimer: ReturnType<typeof setTimeout> | undefined;

    function finish(response: RunnerResponse) {
      if (settled) return;
      settled = true;
      if (globalTimer !== undefined) clearTimeout(globalTimer);
      if (createdTimer !== undefined) clearTimeout(createdTimer);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(response);
    }

    // Global timeout
    globalTimer = setTimeout(async () => {
      // Try to cancel in-progress download if we know the ID
      if (downloadId !== undefined) {
        try {
          await chrome.downloads.cancel(downloadId);
        } catch {
          // Ignore cancel errors
        }
      }
      finish({
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: `download timed out after ${command.timeoutMs}ms`,
        code: 'download_timeout',
        recoverable: false,
      });
    }, command.timeoutMs);

    // Step 1: Listen for download creation BEFORE triggering
    function onCreated(item: chrome.downloads.DownloadItem) {
      if (settled) return;
      // Accept the download if no ID captured yet
      if (downloadId !== undefined) return;
      downloadId = item.id;
      if (createdTimer !== undefined) clearTimeout(createdTimer);
      chrome.downloads.onCreated.removeListener(onCreated);
    }

    chrome.downloads.onCreated.addListener(onCreated);

    // Set a window for download creation — if no download appears within this
    // window after the trigger, we abandon
    createdTimer = setTimeout(() => {
      chrome.downloads.onCreated.removeListener(onCreated);
      if (!settled && downloadId === undefined) {
        finish({
          kind: 'result',
          commandId: command.commandId,
          ok: false,
          message: `No download was created within ${DOWNLOAD_CREATED_WINDOW_MS}ms of the trigger`,
          code: 'download_not_started',
          recoverable: false,
        });
      }
    }, DOWNLOAD_CREATED_WINDOW_MS);

    // Step 3: Watch download progress
    function onChanged(delta: chrome.downloads.DownloadDelta) {
      if (settled) return;
      if (delta.id !== downloadId) return;

      if (delta.state?.current === 'complete') {
        // Query to get the final filename
        chrome.downloads.search({ id: downloadId! }, (results) => {
          if (settled) return;
          const item = results[0];
          const filename = item?.filename ?? '';
          const bytesReceived = item?.bytesReceived ?? 0;

          finish({
            kind: 'result',
            commandId: command.commandId,
            ok: true,
            value: { filename, downloadId: downloadId!, bytesReceived },
          });
        });
      } else if (delta.state?.current === 'interrupted') {
        finish({
          kind: 'result',
          commandId: command.commandId,
          ok: false,
          message: `Download was interrupted: ${delta.error?.current ?? 'unknown'}`,
          code: 'download_interrupted',
          recoverable: false,
        });
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);

    // Step 2: Trigger the download
    triggerDownload(command, tabId).catch((err) => {
      if (!settled) {
        finish({
          kind: 'result',
          commandId: command.commandId,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          code: 'trigger_failed',
          recoverable: false,
        });
      }
    });
  });
}

async function triggerDownload(command: DownloadCommand, tabId: number): Promise<void> {
  if (command.trigger === 'click') {
    if (!command.selectors) {
      throw new Error('download with trigger "click" requires selectors');
    }
    await sendClickToTab(tabId, command.selectors);
  } else {
    // navigation trigger
    if (!command.url) {
      throw new Error('download with trigger "navigation" requires a url');
    }
    await chrome.tabs.update(tabId, { url: command.url });
  }
}

function sendClickToTab(
  tabId: number,
  cascade: DownloadCommand['selectors'],
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        channel: 'runner-dom',
        op: 'click',
        commandId: `download-trigger-${Date.now()}`,
        cascade,
      },
      (reply: DomReply | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? 'sendMessage failed'));
        } else if (!reply) {
          reject(new Error('content script returned no reply'));
        } else if (!reply.ok) {
          reject(new Error(reply.message ?? 'click trigger failed'));
        } else {
          resolve();
        }
      },
    );
  });
}
