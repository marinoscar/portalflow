import type { RecordingSession } from '../shared/types';

const SESSION_KEY = 'portalflow:session';

export async function loadSession(): Promise<RecordingSession | null> {
  const result = await chrome.storage.local.get(SESSION_KEY);
  const session = result[SESSION_KEY];
  return session ?? null;
}

export async function saveSession(session: RecordingSession | null): Promise<void> {
  if (session === null) {
    await chrome.storage.local.remove(SESSION_KEY);
  } else {
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  }
}

export async function updateSession(
  mutator: (session: RecordingSession) => RecordingSession | null,
): Promise<RecordingSession | null> {
  const current = await loadSession();
  if (!current) return null;
  const next = mutator(current);
  await saveSession(next);
  return next;
}
