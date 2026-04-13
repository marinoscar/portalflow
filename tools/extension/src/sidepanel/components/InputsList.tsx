import type { Input } from '@portalflow/schema';

interface Props {
  inputs: Input[];
  onAdd: () => void;
  onUpdate: (index: number, changes: Partial<Input>) => void;
  onRemove: (index: number) => void;
}

const SOURCE_OPTIONS = [
  { value: 'literal', label: 'Literal value' },
  { value: 'env', label: 'Environment variable' },
  { value: 'vaultcli', label: 'Vault (vaultcli)' },
  { value: 'cli_arg', label: 'CLI argument' },
] as const;

const TYPE_OPTIONS = ['string', 'secret', 'number', 'boolean'] as const;

export function InputsList({ inputs, onAdd, onUpdate, onRemove }: Props) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Inputs</h2>
        <button className="btn-small" onClick={onAdd}>
          + Add input
        </button>
      </div>
      {inputs.length === 0 && <p className="muted">No inputs defined.</p>}
      {inputs.map((input, idx) => (
        <div key={idx} className="input-row">
          <input
            className="input-name"
            type="text"
            value={input.name}
            onChange={(e) => onUpdate(idx, { name: e.target.value })}
            placeholder="name"
          />
          <select
            value={input.type}
            onChange={(e) => onUpdate(idx, { type: e.target.value as Input['type'] })}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={input.source ?? 'literal'}
            onChange={(e) => onUpdate(idx, { source: e.target.value as Input['source'] })}
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            className="input-value"
            type="text"
            value={input.value ?? ''}
            onChange={(e) => onUpdate(idx, { value: e.target.value })}
            placeholder={valuePlaceholder(input.source)}
          />
          <button className="btn-ghost" onClick={() => onRemove(idx)}>
            &times;
          </button>
        </div>
      ))}
    </section>
  );
}

function valuePlaceholder(source: Input['source']): string {
  switch (source) {
    case 'env':
      return 'ENV_VAR_NAME';
    case 'vaultcli':
      return 'path/to/secret';
    case 'literal':
      return 'literal value';
    case 'cli_arg':
      return '--arg-name';
    default:
      return '';
  }
}
