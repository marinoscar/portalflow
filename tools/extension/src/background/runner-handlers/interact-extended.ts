import type { InteractCommand, RunnerResponse } from '../../shared/runner-protocol';

interface DomReply {
  ok: boolean;
  message?: string;
  code?: string;
}

/**
 * Sends an interact op to the runner content script and awaits the reply.
 * Shared by select, check, uncheck, hover, and focus.
 */
function sendInteractOp(
  command: InteractCommand,
  tabId: number,
  op: string,
  extra: Record<string, unknown> = {},
): Promise<RunnerResponse> {
  const domOp = (): Promise<DomReply> =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          channel: 'runner-dom',
          op,
          commandId: command.commandId,
          cascade: command.selectors,
          ...extra,
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
      () => reject(new Error(`${op} timed out after ${command.timeoutMs}ms`)),
      command.timeoutMs,
    ),
  );

  return Promise.race([domOp(), timeout]).then(
    (reply) => {
      if (reply.ok) {
        return {
          kind: 'result' as const,
          commandId: command.commandId,
          ok: true as const,
          value: null,
        };
      }
      return {
        kind: 'result' as const,
        commandId: command.commandId,
        ok: false as const,
        message: reply.message ?? `${op} failed`,
        code: reply.code,
        recoverable: false,
      };
    },
    (err) => ({
      kind: 'result' as const,
      commandId: command.commandId,
      ok: false as const,
      message: err instanceof Error ? err.message : String(err),
      code: 'timeout',
      recoverable: true,
    }),
  );
}

/**
 * select: sets the value on a <select> element and dispatches a change event.
 */
export function select(
  command: InteractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  return sendInteractOp(command, tabId, 'select', { value: command.value });
}

/**
 * check: checks a checkbox or radio input.
 */
export function check(
  command: InteractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  return sendInteractOp(command, tabId, 'check');
}

/**
 * uncheck: unchecks a checkbox (radio buttons return an error).
 */
export function uncheck(
  command: InteractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  return sendInteractOp(command, tabId, 'uncheck');
}

/**
 * hover: dispatches mouseenter + mouseover events on the element.
 */
export function hover(
  command: InteractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  return sendInteractOp(command, tabId, 'hover');
}

/**
 * focus: calls element.focus().
 */
export function focus(
  command: InteractCommand,
  tabId: number,
): Promise<RunnerResponse> {
  return sendInteractOp(command, tabId, 'focus');
}
