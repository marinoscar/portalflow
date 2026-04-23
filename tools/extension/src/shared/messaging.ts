import type { Automation } from '@portalflow/schema';
import type {
  ChatMessage,
  HtmlSnapshot,
  RawEvent,
  RecordingSession,
} from './types';

/** Payload for an AI chat edit request from the side panel. */
export interface ChatEditRequest {
  userMessage: string;
  currentAutomation: Automation;
  baseVersionId: string | null;
  /** Up to 3 most-recent unique HtmlSnapshots the side panel decides to send. */
  recentSnapshots: HtmlSnapshot[];
  /** Last 10 chat messages, oldest-first. Does NOT include the new userMessage. */
  chatHistory: ChatMessage[];
}

/** All message types flowing between content script, service worker, and UI. */
export type Message =
  | { type: 'GET_SESSION_STATUS' }
  | { type: 'SESSION_STATUS_RESPONSE'; session: RecordingSession | null }
  | { type: 'START_RECORDING'; tabId: number }
  | { type: 'STOP_RECORDING' }
  | { type: 'PAUSE_RECORDING' }
  | { type: 'RESUME_RECORDING' }
  | { type: 'CLEAR_SESSION' }
  | { type: 'LIST_ARCHIVED_SESSIONS' }
  | { type: 'ARCHIVED_SESSIONS_RESPONSE'; sessions: RecordingSession[] }
  | { type: 'DELETE_ARCHIVED_SESSION'; sessionId: string }
  | { type: 'RESTORE_ARCHIVED_SESSION'; sessionId: string }
  | { type: 'RECORDED_EVENT'; event: RawEvent; snapshot?: HtmlSnapshot }
  | { type: 'SESSION_UPDATED'; session: RecordingSession | null }
  | { type: 'LLM_IMPROVE_SELECTOR'; stepDescription: string; currentSelector: string }
  | { type: 'LLM_GENERATE_GUIDANCE'; stepDescription: string }
  | { type: 'LLM_POLISH_METADATA'; steps: Array<{ name: string; type: string; description?: string }> }
  | { type: 'LLM_IMPROVE_STEPS'; automation: Automation }
  | { type: 'LLM_CHAT_EDIT'; request: ChatEditRequest }
  | { type: 'LLM_VERIFY_CONNECTIVITY' }
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
