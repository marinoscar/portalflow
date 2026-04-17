import type { ExtractCommand, ScreenshotCommand, RunnerResponse } from '../../shared/runner-protocol';
import { screenshot as screenshotHandler } from './screenshot';

interface DomReply {
  ok: boolean;
  value?: unknown;
  message?: string;
  code?: string;
}

/**
 * Delegates an extract operation to the runner content script.
 * Supports targets: text, attribute, html, url, title, screenshot.
 *
 * For 'screenshot', delegates to the screenshot handler which calls
 * chrome.tabs.captureVisibleTab and returns {dataUrl: string}.
 *
 * Times out after command.timeoutMs milliseconds.
 */
export async function extract(
  command: ExtractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  if (command.target === 'screenshot') {
    const screenshotCmd: ScreenshotCommand = {
      type: 'screenshot',
      commandId: command.commandId,
      timeoutMs: command.timeoutMs,
      tab: command.tab,
      saveDir: '',
    };
    return screenshotHandler(screenshotCmd, tabId);
  }

  // url and title can be resolved via chrome.tabs.get — no content script needed.
  // This is critical because the run window starts on about:blank where no
  // content script is injected.
  if (command.target === 'url' || command.target === 'title') {
    try {
      const tab = await chrome.tabs.get(tabId);
      const value = command.target === 'url' ? (tab.url ?? '') : (tab.title ?? '');
      return { kind: 'result', commandId: command.commandId, ok: true, value };
    } catch (err) {
      return {
        kind: 'result',
        commandId: command.commandId,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        code: 'tabs_get_failed',
        recoverable: true,
      };
    }
  }

  const domOp = (): Promise<DomReply> =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          channel: 'runner-dom',
          op: 'extract',
          commandId: command.commandId,
          target: command.target,
          cascade: command.selectors,
          attribute: command.attribute,
        },
        (reply: DomReply | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message ?? 'sendMessage failed'));
          } else if (!reply) {
            reject(new Error('content script returned no reply'));
          } else {
            resolve(reply);
          }
        },
      );
    });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`extract timed out after ${command.timeoutMs}ms`)),
      command.timeoutMs,
    ),
  );

  let reply: DomReply;
  try {
    reply = await Promise.race([domOp(), timeout]);
  } catch (err) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 'timeout',
      recoverable: true,
    };
  }

  if (reply.ok) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: true,
      value: reply.value,
    };
  }
  return {
    kind: 'result',
    commandId: command.commandId,
    ok: false,
    message: reply.message ?? 'extract failed',
    code: reply.code,
    recoverable: false,
  };
}
