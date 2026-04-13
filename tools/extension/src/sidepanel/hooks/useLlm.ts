import { useState, useEffect } from 'react';
import { sendMessage } from '../../shared/messaging';
import type { Message } from '../../shared/messaging';
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
