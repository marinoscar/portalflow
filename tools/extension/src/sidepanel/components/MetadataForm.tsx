import type { Automation } from '@portalflow/schema';
import { useHasActiveProvider, useLlmCall } from '../hooks/useLlm';

interface Props {
  automation: Automation;
  onChange: (changes: Partial<Pick<Automation, 'name' | 'goal' | 'description' | 'version'>>) => void;
}

export function MetadataForm({ automation, onChange }: Props) {
  const hasProvider = useHasActiveProvider();
  const { call, loading, error } = useLlmCall();

  const handleAutoFill = async () => {
    const steps = automation.steps.map((s) => ({
      name: s.name,
      type: s.type,
      description: s.description,
    }));
    const result = await call<{ name?: string; goal?: string; description?: string }>({
      type: 'LLM_POLISH_METADATA',
      steps,
    });
    if (result) {
      onChange({
        name: result.name ?? automation.name,
        goal: result.goal ?? automation.goal,
        description: result.description ?? automation.description,
      });
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Automation details</h2>
        <button
          className="btn-small"
          onClick={handleAutoFill}
          disabled={!hasProvider || loading || automation.steps.length === 0}
          title={
            !hasProvider
              ? 'Configure an LLM provider in settings'
              : automation.steps.length === 0
                ? 'Record some steps first'
                : 'Auto-fill name, goal, and description with LLM'
          }
        >
          {loading ? 'Generating...' : 'Auto-fill with LLM'}
        </button>
      </div>
      {error && <div className="error-inline">{error}</div>}
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={automation.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="My automation"
        />
      </label>
      <label className="field">
        <span>Goal</span>
        <textarea
          value={automation.goal}
          onChange={(e) => onChange({ goal: e.target.value })}
          placeholder="What is this automation trying to achieve?"
          rows={2}
        />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          value={automation.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="A longer description for operators"
          rows={2}
        />
      </label>
      <label className="field">
        <span>Version</span>
        <input
          type="text"
          value={automation.version}
          onChange={(e) => onChange({ version: e.target.value })}
          placeholder="1.0.0"
        />
      </label>
    </section>
  );
}
