import type { Automation } from '@portalflow/schema';
import type { HtmlSnapshot, RawEvent, RecordingSession } from './types';

/** All message types flowing between content script, service worker, and UI. */
export type Message =
  | { type: 'GET_SESSION_STATUS' }
  | { type: 'SESSION_STATUS_RESPONSE'; session: RecordingSession | null }
  | { type: 'START_RECORDING'; tabId: number }
  | { type: 'STOP_RECORDING' }
  | { type: 'PAUSE_RECORDING' }
  | { type: 'RESUME_RECORDING' }
  | { type: 'CLEAR_SESSION' }
  | { type: 'RECORDED_EVENT'; event: RawEvent; snapshot?: HtmlSnapshot }
  | { type: 'SESSION_UPDATED'; session: RecordingSession | null }
  | { type: 'LLM_IMPROVE_SELECTOR'; stepDescription: string; currentSelector: string }
  | { type: 'LLM_GENERATE_GUIDANCE'; stepDescription: string }
  | { type: 'LLM_POLISH_METADATA'; steps: Array<{ name: string; type: string; description?: string }> }
  | { type: 'LLM_IMPROVE_STEPS'; automation: Automation }
  | { type: 'LLM_RESULT'; ok: true; data: unknown }
  | { type: 'LLM_ERROR'; ok: false; error: string };

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
