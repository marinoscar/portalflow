import type { CountMatchingCommand, RunnerResponse } from '../../shared/runner-protocol';

interface DomReply {
  ok: boolean;
  value?: { count: number };
  message?: string;
  code?: string;
}

/**
 * Asks the content script to count elements matching the given cascade.
 * Returns {ok: true, value: {count}} on success.
 */
export async function countMatching(
  command: CountMatchingCommand,
  tabId: number,
): Promise<RunnerResponse> {
  const domOp = (): Promise<DomReply> =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          channel: 'runner-dom',
          op: 'countMatching',
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
      () => reject(new Error(`countMatching timed out after ${command.timeoutMs}ms`)),
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
      value: reply.value ?? { count: 0 },
    };
  }
  return {
    kind: 'result',
    commandId: command.commandId,
    ok: false,
    message: reply.message ?? 'countMatching failed',
    code: reply.code,
    recoverable: false,
  };
}
