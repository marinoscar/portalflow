import type { AutomationVersion, VersionAuthor } from '../../shared/types';

interface VersionHistoryProps {
  open: boolean;
  onClose: () => void;
  versions: AutomationVersion[];
  currentVersionId: string | null;
  onCheckout: (versionId: string) => void;
}

const AUTHOR_LABELS: Record<VersionAuthor, string> = {
  'raw-recording': 'Recording',
  'user-edit': 'Manual edit',
  'ai-chat': 'AI chat',
  'ai-improve-legacy': 'AI improve',
  import: 'Imported',
};

const AUTHOR_CLASSES: Record<VersionAuthor, string> = {
  'raw-recording': 'version-badge version-badge--raw',
  'user-edit': 'version-badge version-badge--user',
  'ai-chat': 'version-badge version-badge--ai-chat',
  'ai-improve-legacy': 'version-badge version-badge--ai-legacy',
  import: 'version-badge version-badge--import',
};

function formatRelative(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function VersionHistory({
  open,
  onClose,
  versions,
  currentVersionId,
  onCheckout,
}: VersionHistoryProps) {
  if (!open) return null;

  // Display newest first.
  const rows = [...versions].reverse();

  return (
    <div className="version-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="version-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Version history"
      >
        <header className="version-drawer-header">
          <h2>Version history</h2>
          <button
            className="version-drawer-close"
            onClick={onClose}
            aria-label="Close version history"
            type="button"
          >
            ×
          </button>
        </header>
        <div className="version-drawer-body">
          {rows.length === 0 && (
            <p className="muted">
              No versions yet. Versions are created automatically 2 seconds
              after each edit, or when the AI chat approves a proposal.
            </p>
          )}
          {rows.map((v, i) => {
            const isCurrent = v.id === currentVersionId;
            const number = versions.length - i;
            return (
              <div
                key={v.id}
                className={`version-row${isCurrent ? ' version-row--current' : ''}`}
              >
                <div className="version-row-header">
                  <span className="version-number">#{number}</span>
                  <span className={AUTHOR_CLASSES[v.author]}>
                    {AUTHOR_LABELS[v.author]}
                  </span>
                  <span className="version-time" title={new Date(v.createdAt).toISOString()}>
                    {formatRelative(v.createdAt)}
                  </span>
                </div>
                <div className="version-message" title={v.message}>
                  {v.message}
                </div>
                <div className="version-actions">
                  {isCurrent ? (
                    <span className="version-current-label">Current</span>
                  ) : (
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => onCheckout(v.id)}
                      type="button"
                    >
                      Checkout
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
