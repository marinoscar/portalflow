import type { Automation } from '@portalflow/schema';

interface Props {
  automation: Automation;
  onChange: (changes: Partial<Pick<Automation, 'name' | 'goal' | 'description' | 'version'>>) => void;
}

export function MetadataForm({ automation, onChange }: Props) {
  return (
    <section className="card">
      <h2 className="card-title">Automation details</h2>
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
