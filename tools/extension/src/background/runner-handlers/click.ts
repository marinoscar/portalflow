import type { InteractCommand, RunnerResponse } from '../../shared/runner-protocol';

interface DomReply {
  ok: boolean;
  message?: string;
  code?: string;
}

/**
 * Sends a click operation to the runner content script in the given tab,
 * delegating the actual DOM interaction to runner-content.ts.
 *
 * Times out after command.timeoutMs milliseconds.
 */
export async function click(
  command: InteractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  const domOp = (): Promise<DomReply> =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          channel: 'runner-dom',
          op: 'click',
          commandId: command.commandId,
          cascade: command.selectors,
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
      () => reject(new Error(`click timed out after ${command.timeoutMs}ms`)),
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
    message: reply.message ?? 'click failed',
    code: reply.code,
    recoverable: false,
  };
}
