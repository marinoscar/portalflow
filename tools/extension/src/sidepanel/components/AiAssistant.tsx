import { useState, useEffect } from 'react';
import { AutomationSchema, type Automation, type Step } from '@portalflow/schema';
import { useHasActiveProvider, useLlmCall, useVerifyConnectivity } from '../hooks/useLlm';
import { LlmConnectivityBanner } from './LlmConnectivityBanner';

interface Props {
  automation: Automation;
  onUpdateMetadata: (changes: Partial<Pick<Automation, 'name' | 'goal' | 'description'>>) => void;
  onReplaceSteps: (steps: Step[]) => void;
}

interface AiResult {
  kind: 'metadata' | 'steps';
  changes: string[];
}

export function AiAssistant({ automation, onUpdateMetadata, onReplaceSteps }: Props) {
  const hasProvider = useHasActiveProvider();
  const { call, loading, error } = useLlmCall();
  const {
    check: verifyConnectivity,
    loading: verifying,
    lastResult: pingResult,
  } = useVerifyConnectivity();
  const [menuOpen, setMenuOpen] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Run a connectivity check once when the provider becomes configured,
  // and every time the configured provider changes. This surfaces a
  // broken API key / bad base-url / offline state BEFORE the user
  // triggers a chat edit or metadata polish — matching the CLI's
  // pre-flight behavior.
  useEffect(() => {
    if (!hasProvider) return;
    setBannerDismissed(false);
    verifyConnectivity();
  }, [hasProvider, verifyConnectivity]);

  const connectivityFailed = pingResult !== null && !pingResult.ok;
  const disabled =
    !hasProvider || loading || verifying || automation.steps.length === 0 || connectivityFailed;
  const disabledReason = !hasProvider
    ? 'Configure an LLM provider in settings'
    : automation.steps.length === 0
      ? 'Record some steps first'
      : connectivityFailed
        ? 'LLM connectivity check failed — see banner'
        : undefined;

  const handleUpdateMetadata = async () => {
    setMenuOpen(false);
    setResult(null);
    setValidationError(null);

    const steps = automation.steps.map((s) => ({
      name: s.name,
      type: s.type,
      description: s.description,
    }));

    const llmResult = await call<{ name?: string; goal?: string; description?: string }>({
      type: 'LLM_POLISH_METADATA',
      steps,
    });

    if (llmResult) {
      onUpdateMetadata({
        name: llmResult.name ?? automation.name,
        goal: llmResult.goal ?? automation.goal,
        description: llmResult.description ?? automation.description,
      });

      const applied: string[] = [];
      if (llmResult.name) applied.push(`Name updated: "${llmResult.name}"`);
      if (llmResult.goal) applied.push('Goal rewritten');
      if (llmResult.description) applied.push('Description rewritten');
      if (applied.length === 0) applied.push('No metadata changes produced by the LLM.');
      setResult({ kind: 'metadata', changes: applied });
    }
  };

  const handleImproveSteps = async () => {
    setMenuOpen(false);
    setResult(null);
    setValidationError(null);

    const llmResult = await call<{ steps: unknown; changes?: string[] }>({
      type: 'LLM_IMPROVE_STEPS',
      automation,
    });

    if (!llmResult) return;
    if (!llmResult.steps || !Array.isArray(llmResult.steps)) {
      setValidationError('LLM did not return a valid steps array.');
      return;
    }

    // Validate the proposed steps by constructing a full test automation and
    // running it through AutomationSchema. If it fails, bail out and surface
    // the Zod errors to the user. If it passes, apply the steps and renumber IDs.
    const test = { ...automation, steps: llmResult.steps };
    const parse = AutomationSchema.safeParse(test);
    if (!parse.success) {
      const flat = parse.error.flatten();
      const errors: string[] = [];
      for (const e of flat.formErrors) errors.push(e);
      for (const [field, errs] of Object.entries(flat.fieldErrors)) {
        for (const e of errs ?? []) errors.push(`${field}: ${e}`);
      }
      setValidationError(
        `LLM returned steps that failed schema validation. No changes were applied.\n\n${errors.join('\n')}`,
      );
      return;
    }

    onReplaceSteps(parse.data.steps);
    const changes = Array.isArray(llmResult.changes) && llmResult.changes.length > 0
      ? llmResult.changes.filter((c): c is string => typeof c === 'string')
      : ['Steps rewritten by the LLM (no change summary provided).'];
    setResult({ kind: 'steps', changes });
  };

  return (
    <section className="card ai-assistant">
      <div className="card-header">
        <h2 className="card-title">AI Assistant</h2>
      </div>

      <button
        className="ai-menu-trigger"
        onClick={() => setMenuOpen((o) => !o)}
        disabled={disabled}
        title={disabledReason}
        type="button"
      >
        {loading ? 'Working...' : 'AI Assistant'}
        <span className={`ai-menu-trigger-chevron${menuOpen ? ' open' : ''}`} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {menuOpen && !loading && (
        <div className="ai-menu">
          <button className="ai-menu-item" onClick={handleUpdateMetadata} disabled={disabled} type="button">
            <strong>Update Metadata</strong>
            <span>Generate name, goal, and description from the recorded steps</span>
          </button>
          <button className="ai-menu-item" onClick={handleImproveSteps} disabled={disabled} type="button">
            <strong>Improve Steps</strong>
            <span>Review every step, remove duplicates, improve selectors, add validation and guidance</span>
          </button>
        </div>
      )}

      {loading && (
        <div className="ai-loading">
          <span className="ai-loading-spinner" aria-hidden="true" />
          <span>AI is thinking... this may take 10-30 seconds for Improve Steps.</span>
        </div>
      )}

      {pingResult && !pingResult.ok && !bannerDismissed && (
        <LlmConnectivityBanner
          result={pingResult}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {error && <div className="error-inline">{error}</div>}
      {validationError && <div className="error-inline" style={{ whiteSpace: 'pre-wrap' }}>{validationError}</div>}

      {result && !loading && (
        <div className="ai-result">
          <strong>{result.kind === 'metadata' ? 'Metadata updated' : 'Steps improved'}</strong>
          <ul>
            {result.changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
