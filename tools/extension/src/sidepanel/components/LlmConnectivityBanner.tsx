import type { PingResult } from '../../llm/provider.interface';

/**
 * Red banner the sidepanel renders when `useVerifyConnectivity().check()`
 * returns a failing PingResult. Shape mirrors the CLI's `formatPingFailure`
 * block so users who switch between the two surfaces see familiar
 * messaging.
 *
 * Renders nothing when the result is ok or still loading — callers should
 * gate on `result?.ok === false` before mounting this component.
 */
export function LlmConnectivityBanner({
  result,
  onDismiss,
}: {
  result: Extract<PingResult, { ok: false }>;
  onDismiss?: () => void;
}) {
  return (
    <div className="banner banner-danger" role="alert">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <strong>LLM connectivity check failed</strong>
        {onDismiss && (
          <button
            className="btn-ghost"
            onClick={onDismiss}
            style={{ marginLeft: '0.5rem' }}
            title="Dismiss"
            type="button"
          >
            &times;
          </button>
        )}
      </div>
      <div className="hint-small" style={{ marginTop: '0.25rem' }}>
        <div>
          <strong>Provider:</strong> {result.providerName}
          {result.model && result.model !== '(none)' && result.model !== '(unset)' && (
            <> (model: {result.model})</>
          )}
        </div>
        <div style={{ marginTop: '0.25rem' }}>
          <strong>Error:</strong> {result.message}
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <strong>What to try:</strong>
          <div>{result.hint}</div>
        </div>
      </div>
    </div>
  );
}
