import type { ScrollCommand, RunnerResponse } from '../../shared/runner-protocol';

interface DomReply {
  ok: boolean;
  message?: string;
  code?: string;
}

/**
 * Scrolls the page in the given direction by sending a 'scroll' op to the
 * runner content script. The content script calls window.scrollBy /
 * window.scrollTo as appropriate.
 *
 * Directions:
 *   - 'up'     → scrollBy(0, -amountPx) — default 500 px
 *   - 'down'   → scrollBy(0, +amountPx)
 *   - 'top'    → scrollTo(0, 0)
 *   - 'bottom' → scrollTo(0, document.body.scrollHeight)
 */
export async function scroll(
  command: ScrollCommand,
  tabId: number,
): Promise<RunnerResponse> {
  const domOp = (): Promise<DomReply> =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          channel: 'runner-dom',
          op: 'scroll',
          commandId: command.commandId,
          direction: command.direction,
          amountPx: command.amountPx,
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
      () => reject(new Error(`scroll timed out after ${command.timeoutMs}ms`)),
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
      value: null,
    };
  }
  return {
    kind: 'result',
    commandId: command.commandId,
    ok: false,
    message: reply.message ?? 'scroll failed',
    code: reply.code,
    recoverable: false,
  };
}
