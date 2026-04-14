import type { RecordingSession } from '../shared/types';

const SESSION_KEY = 'portalflow:session';
const ARCHIVE_KEY = 'portalflow:sessions-archive';

// --- Current (active) session ------------------------------------------------

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

// --- Archive -----------------------------------------------------------------

/**
 * A session is worth archiving only if it carries content the user could
 * reasonably want back later: events recorded, versions captured, or a
 * named/described automation derived from it. Empty scaffolding sessions
 * (the default `{ events: [], metadata: { name: '', ... } }` a start-then-
 * immediately-clear cycle produces) would otherwise pile up as noise.
 */
export function isSessionWorthArchiving(session: RecordingSession | null): boolean {
  if (!session) return false;
  if (session.events && session.events.length > 0) return true;
  if (session.versions && session.versions.length > 0) return true;
  if (session.original) return true;
  const name = session.metadata?.name?.trim();
  if (name && name.length > 0) return true;
  return false;
}

export async function loadArchive(): Promise<RecordingSession[]> {
  const result = await chrome.storage.local.get(ARCHIVE_KEY);
  const archive = result[ARCHIVE_KEY];
  return Array.isArray(archive) ? (archive as RecordingSession[]) : [];
}

async function saveArchive(archive: RecordingSession[]): Promise<void> {
  await chrome.storage.local.set({ [ARCHIVE_KEY]: archive });
}

/**
 * Move the current session into the archive and clear the active slot.
 * No-op when the session is null or not worth archiving (empty scaffold).
 * Returns the resulting archive array (newest first).
 */
export async function archiveCurrentSession(): Promise<RecordingSession[]> {
  const current = await loadSession();
  const archive = await loadArchive();

  if (isSessionWorthArchiving(current)) {
    // Mark the archived copy as stopped and timestamp its end (if not
    // already) so the UI can show a stable "ended at" for sorting.
    const stamped: RecordingSession = {
      ...(current as RecordingSession),
      status: 'stopped',
      endedAt: current!.endedAt ?? Date.now(),
    };

    // If this session id is already in the archive (e.g. previously
    // archived and now being re-archived), replace it. Otherwise prepend.
    const withoutDup = archive.filter((s) => s.id !== stamped.id);
    const next = [stamped, ...withoutDup];
    await saveArchive(next);
  }

  await saveSession(null);
  return loadArchive();
}

export async function deleteArchivedSession(id: string): Promise<RecordingSession[]> {
  const archive = await loadArchive();
  const next = archive.filter((s) => s.id !== id);
  await saveArchive(next);
  return next;
}

/**
 * Swap an archived session into the active slot. The current active session
 * (if any and worth keeping) is archived first so nothing is lost.
 *
 * Returns the new active session, or null if the requested id was not in
 * the archive.
 */
export async function restoreArchivedSession(
  id: string,
): Promise<RecordingSession | null> {
  const archive = await loadArchive();
  const target = archive.find((s) => s.id === id);
  if (!target) return null;

  // Archive whatever is currently active so switching is non-destructive.
  await archiveCurrentSession();

  // Pull the target out of the archive and install it as active.
  const remaining = (await loadArchive()).filter((s) => s.id !== id);
  await saveArchive(remaining);
  await saveSession(target);

  return target;
}
