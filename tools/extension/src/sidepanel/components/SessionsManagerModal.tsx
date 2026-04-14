import { useEffect, useState } from 'react';
import type { RecordingSession } from '../../shared/types';
import { sendMessage } from '../../shared/messaging';

interface Props {
  currentSession: RecordingSession | null;
  onOpen: (session: RecordingSession) => void;
  onClose: () => void;
}

interface ArchivedSessionsResponse {
  type: 'ARCHIVED_SESSIONS_RESPONSE';
  sessions: RecordingSession[];
}

interface SessionStatusResponse {
  type: 'SESSION_STATUS_RESPONSE';
  session: RecordingSession | null;
}

function formatDate(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeSession(session: RecordingSession): string {
  const name = session.metadata?.name?.trim();
  if (name) return name;
  const eventCount = session.events?.length ?? 0;
  return `Untitled session · ${eventCount} event${eventCount === 1 ? '' : 's'}`;
}

export function SessionsManagerModal({ currentSession, onOpen, onClose }: Props) {
  const [archive, setArchive] = useState<RecordingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await sendMessage<ArchivedSessionsResponse>({
        type: 'LIST_ARCHIVED_SESSIONS',
      });
      setArchive(res.sessions ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleOpen = async (sessionId: string) => {
    setBusyId(sessionId);
    try {
      const res = await sendMessage<SessionStatusResponse>({
        type: 'RESTORE_ARCHIVED_SESSION',
        sessionId,
      });
      if (res.session) {
        onOpen(res.session);
      } else {
        setError('Session could not be restored.');
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async (id: string) => {
    setBusyId(id);
    try {
      const res = await sendMessage<ArchivedSessionsResponse>({
        type: 'DELETE_ARCHIVED_SESSION',
        sessionId: id,
      });
      setArchive(res.sessions ?? []);
      setPendingDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  // Build the combined list shown to the user: the active (current) session
  // at the top, followed by every archived session. The active session is
  // marked with a "Current" badge and has no Open/Delete actions — those
  // only make sense for non-active entries. Use the Reset Session header
  // button to retire the active session.
  type Row = { session: RecordingSession; isCurrent: boolean };
  const rows: Row[] = [];
  if (currentSession) {
    rows.push({ session: currentSession, isCurrent: true });
  }
  if (archive) {
    for (const s of archive) {
      if (currentSession && s.id === currentSession.id) continue;
      rows.push({ session: s, isCurrent: false });
    }
  }

  const loading = archive === null;
  const hasContent = rows.length > 0;

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <h3>Saved sessions</h3>
        <p className="modal-desc">
          Open a previous session or delete ones you no longer need. Opening a saved
          session archives whatever you're currently editing, so nothing is lost.
        </p>

        {error && <p className="modal-error">{error}</p>}

        {loading ? (
          <p className="modal-desc">Loading…</p>
        ) : !hasContent ? (
          <p className="modal-desc">
            No sessions yet. Start recording to create one, or reset the current
            session to move it here.
          </p>
        ) : (
          <ul className="session-list">
            {rows.map(({ session: s, isCurrent }) => {
              const isPendingDelete = pendingDeleteId === s.id;
              const isBusy = busyId === s.id;
              return (
                <li
                  key={s.id}
                  className={`session-row${isCurrent ? ' session-row-current' : ''}`}
                >
                  <div className="session-row-main">
                    <div className="session-row-title">
                      {describeSession(s)}
                      {isCurrent && (
                        <span className="session-row-badge">Current</span>
                      )}
                    </div>
                    <div className="session-row-meta">
                      <span>Started: {formatDate(s.startedAt)}</span>
                      <span>Ended: {formatDate(s.endedAt)}</span>
                      <span>{s.events?.length ?? 0} events</span>
                    </div>
                  </div>
                  <div className="session-row-actions">
                    {isCurrent ? (
                      <span className="session-row-hint">In side panel</span>
                    ) : !isPendingDelete ? (
                      <>
                        <button
                          className="btn-small"
                          onClick={() => void handleOpen(s.id)}
                          disabled={isBusy}
                          title="Open this session"
                        >
                          Open
                        </button>
                        <button
                          className="btn-small btn-danger"
                          onClick={() => setPendingDeleteId(s.id)}
                          disabled={isBusy}
                          title="Delete this session"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="session-row-confirm">Delete this session?</span>
                        <button
                          className="btn-small"
                          onClick={() => setPendingDeleteId(null)}
                          disabled={isBusy}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn-small btn-danger"
                          onClick={() => void handleConfirmDelete(s.id)}
                          disabled={isBusy}
                        >
                          {isBusy ? 'Deleting…' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
