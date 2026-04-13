import type { RawEvent, RecordingSession } from './types';

/** All message types flowing between content script, service worker, and UI. */
export type Message =
  | { type: 'GET_SESSION_STATUS' }
  | { type: 'SESSION_STATUS_RESPONSE'; session: RecordingSession | null }
  | { type: 'START_RECORDING'; tabId: number }
  | { type: 'STOP_RECORDING' }
  | { type: 'PAUSE_RECORDING' }
  | { type: 'RESUME_RECORDING' }
  | { type: 'CLEAR_SESSION' }
  | { type: 'RECORDED_EVENT'; event: RawEvent }
  | { type: 'SESSION_UPDATED'; session: RecordingSession | null };

export function sendMessage<T = unknown>(msg: Message): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response as T);
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
