import React, { useState, useEffect } from 'react';

interface KeyValueListProps {
  label: string;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  hint?: string;
}

type Pair = [string, string];

function recordToPairs(record: Record<string, string>): Pair[] {
  return Object.entries(record);
}

function pairsToRecord(pairs: Pair[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of pairs) {
    if (k !== '') {
      result[k] = v;
    }
  }
  return result;
}

export function KeyValueList({
  label,
  value,
  onChange,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
  hint,
}: KeyValueListProps) {
  // Internal state preserves order and allows blank keys while typing
  const [pairs, setPairs] = useState<Pair[]>(() => recordToPairs(value));

  // Sync when external value changes (e.g., on LOAD)
  useEffect(() => {
    setPairs(recordToPairs(value));
  // We only want to re-sync when the external identity changes significantly.
  // Comparing JSON is a cheap deep-equal approximation for small records.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  function update(next: Pair[]) {
    setPairs(next);
    onChange(pairsToRecord(next));
  }

  function handleKeyChange(idx: number, newKey: string) {
    const next = pairs.map((p, i) => (i === idx ? ([newKey, p[1]] as Pair) : p));
    update(next);
  }

  function handleValueChange(idx: number, newVal: string) {
    const next = pairs.map((p, i) => (i === idx ? ([p[0], newVal] as Pair) : p));
    update(next);
  }

  function handleRemove(idx: number) {
    update(pairs.filter((_, i) => i !== idx));
  }

  function handleAdd() {
    update([...pairs, ['', '']]);
  }

  return (
    <div className="field field--kv-list">
      <span>{label}</span>
      {pairs.map((pair, idx) => (
        <div key={idx} className="kv-row">
          <input
            type="text"
            value={pair[0]}
            onChange={(e) => handleKeyChange(idx, e.target.value)}
            placeholder={keyPlaceholder}
            className="kv-input"
          />
          <input
            type="text"
            value={pair[1]}
            onChange={(e) => handleValueChange(idx, e.target.value)}
            placeholder={valuePlaceholder}
            className="kv-input"
          />
          <button
            type="button"
            className="btn-ghost kv-remove"
            onClick={() => handleRemove(idx)}
            aria-label="Remove"
          >
            &times;
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost kv-add" onClick={handleAdd}>
        + Add
      </button>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}
