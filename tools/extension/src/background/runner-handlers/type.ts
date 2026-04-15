import type { InteractCommand, RunnerResponse } from '../../shared/runner-protocol';

interface DomReply {
  ok: boolean;
  message?: string;
  code?: string;
}

/**
 * Sends a type operation to the runner content script in the given tab.
 * Requires command.value to be set; returns an error if it is undefined.
 *
 * Times out after command.timeoutMs milliseconds.
 */
export async function type(
  command: InteractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  if (command.value === undefined) {
    return {
      kind: 'result',
      commandId: command.commandId,
      ok: false,
      message: 'type command requires a value',
      code: 'type_requires_value',
      recoverable: false,
    };
  }

  const domOp = (): Promise<DomReply> =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          channel: 'runner-dom',
          op: 'type',
          commandId: command.commandId,
          cascade: command.selectors,
          text: command.value,
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
      () => reject(new Error(`type timed out after ${command.timeoutMs}ms`)),
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
    message: reply.message ?? 'type failed',
    code: reply.code,
    recoverable: false,
  };
}
