import { useState, useEffect, useCallback } from 'react';
import { sendMessage } from '../../shared/messaging';
import type { Message } from '../../shared/messaging';
import type { PingResult } from '../../llm/provider.interface';
import { getActiveProviderConfig } from '../../storage/config.storage';

export function useHasActiveProvider(): boolean {
  const [hasProvider, setHasProvider] = useState(false);
  useEffect(() => {
    getActiveProviderConfig().then((r) => setHasProvider(r !== null));
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return;
      if ('portalflow:config' in changes) {
        getActiveProviderConfig().then((r) => setHasProvider(r !== null));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  return hasProvider;
}

export function useLlmCall() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async <T,>(msg: Message): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const response = (await sendMessage(msg)) as
        | { type: 'LLM_RESULT'; ok: true; data: T }
        | { type: 'LLM_ERROR'; ok: false; error: string };
      if (response && 'ok' in response && response.ok) {
        return response.data;
      }
      setError(response && 'error' in response ? response.error : 'Unknown error');
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { call, loading, error };
}

/**
 * Cheap, opt-in connectivity check. Used by the AiAssistant banner to
 * render a clear red block when the configured provider can't be reached
 * BEFORE the user fires off a chat message or selector-improve action.
 *
 * `check()` returns the structured PingResult so callers can decide
 * whether to gate a follow-up action on `result.ok`. `loading` and
 * `lastResult` are also exposed for declarative UI use.
 */
export function useVerifyConnectivity() {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<PingResult | null>(null);

  const check = useCallback(async (): Promise<PingResult | null> => {
    setLoading(true);
    try {
      const response = (await sendMessage({ type: 'LLM_VERIFY_CONNECTIVITY' })) as
        | { type: 'LLM_RESULT'; ok: true; data: PingResult }
        | { type: 'LLM_ERROR'; ok: false; error: string };
      if (response && 'ok' in response && response.ok) {
        setLastResult(response.data);
        return response.data;
      }
      // Message passing itself failed — synthesize a PingResult so callers
      // get the same shape in both failure modes.
      const synthesized: PingResult = {
        ok: false,
        providerName: '(unknown)',
        model: '(unknown)',
        message:
          'Could not reach the PortalFlow service worker to run the LLM connectivity check.',
        hint: 'Reload the extension (chrome://extensions → reload) and try again.',
        raw: response && 'error' in response ? response.error : 'no response',
      };
      setLastResult(synthesized);
      return synthesized;
    } finally {
      setLoading(false);
    }
  }, []);

  return { check, loading, lastResult };
}
