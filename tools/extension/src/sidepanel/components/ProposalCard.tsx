import type { AutomationProposal } from '../../shared/types';

interface ProposalCardProps {
  proposal: AutomationProposal;
  onApprove: () => void;
  onReject: () => void;
}

export function ProposalCard({ proposal, onApprove, onReject }: ProposalCardProps) {
  const status = proposal.status;
  return (
    <div className={`proposal-card proposal-card--${status}`}>
      <div className="proposal-card-header">
        <span className="proposal-card-title">Proposal</span>
        {status === 'approved' && (
          <span className="proposal-card-status proposal-card-status--approved">
            ✓ Applied
          </span>
        )}
        {status === 'rejected' && (
          <span className="proposal-card-status proposal-card-status--rejected">
            ✕ Rejected
          </span>
        )}
      </div>
      <p className="proposal-card-summary">{proposal.summary}</p>
      {proposal.changes.length > 0 && (
        <>
          <div className="proposal-card-changes-label">Changes:</div>
          <ul className="proposal-card-changes">
            {proposal.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
      {status === 'pending' && (
        <div className="proposal-card-actions">
          <button
            className="btn-primary btn-small"
            onClick={onApprove}
            type="button"
          >
            Approve
          </button>
          <button
            className="btn-secondary btn-small"
            onClick={onReject}
            type="button"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
