import type { AnyMatchCommand, RunnerResponse } from '../../shared/runner-protocol';

interface DomReply {
  ok: boolean;
  value?: { exists: boolean };
  message?: string;
  code?: string;
}

/**
 * Asks the content script whether any element matches the given cascade.
 * Returns {ok: true, value: {exists: boolean}} on success.
 */
export async function anyMatch(
  command: AnyMatchCommand,
  tabId: number,
): Promise<RunnerResponse> {
  const domOp = (): Promise<DomReply> =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          channel: 'runner-dom',
          op: 'anyMatch',
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
      () => reject(new Error(`anyMatch timed out after ${command.timeoutMs}ms`)),
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
      value: reply.value ?? { exists: false },
    };
  }
  return {
    kind: 'result',
    commandId: command.commandId,
    ok: false,
    message: reply.message ?? 'anyMatch failed',
    code: reply.code,
    recoverable: false,
  };
}
