import React, { useState, useEffect } from 'react';
import type { Selectors } from '@portalflow/schema';
import { CheckboxField } from './CheckboxField';
import { TextField } from './TextField';

interface SelectorsEditorProps {
  value: Selectors | undefined;
  onChange: (next: Selectors | undefined) => void;
  errors?: Record<string, string>;
}

export function SelectorsEditor({ value, onChange, errors = {} }: SelectorsEditorProps) {
  const enabled = value !== undefined;
  const [fallbacks, setFallbacks] = useState<string[]>(value?.fallbacks ?? []);

  // Sync fallbacks list when value changes externally
  useEffect(() => {
    setFallbacks(value?.fallbacks ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value?.fallbacks)]);

  function handleToggle(checked: boolean) {
    if (!checked) {
      onChange(undefined);
    } else {
      onChange({ primary: '' });
    }
  }

  function handlePrimaryChange(primary: string) {
    onChange({ primary, fallbacks: fallbacks.length > 0 ? fallbacks : undefined });
  }

  function handleFallbackChange(idx: number, val: string) {
    const next = fallbacks.map((f, i) => (i === idx ? val : f));
    setFallbacks(next);
    onChange({
      primary: value?.primary ?? '',
      fallbacks: next.length > 0 ? next : undefined,
    });
  }

  function handleFallbackRemove(idx: number) {
    const next = fallbacks.filter((_, i) => i !== idx);
    setFallbacks(next);
    onChange({
      primary: value?.primary ?? '',
      fallbacks: next.length > 0 ? next : undefined,
    });
  }

  function handleFallbackAdd() {
    const next = [...fallbacks, ''];
    setFallbacks(next);
    onChange({
      primary: value?.primary ?? '',
      fallbacks: next,
    });
  }

  return (
    <div className="selectors-editor">
      <CheckboxField
        label="Use selectors"
        checked={enabled}
        onChange={handleToggle}
        hint="Override automatic element detection with explicit CSS/XPath selectors"
      />
      {enabled && (
        <div className="selectors-editor-fields">
          <TextField
            label="Primary selector"
            value={value?.primary ?? ''}
            onChange={handlePrimaryChange}
            placeholder="CSS selector or XPath"
            monospace
            required
            error={errors['primary']}
          />
          <div className="field">
            <span>Fallback selectors</span>
            {fallbacks.map((fb, idx) => (
              <div key={idx} className="kv-row" style={{ marginBottom: 4 }}>
                <input
                  type="text"
                  value={fb}
                  onChange={(e) => handleFallbackChange(idx, e.target.value)}
                  placeholder="Fallback selector"
                  style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-ghost kv-remove"
                  onClick={() => handleFallbackRemove(idx)}
                  aria-label="Remove fallback"
                >
                  &times;
                </button>
              </div>
            ))}
            <button type="button" className="btn-ghost kv-add" onClick={handleFallbackAdd}>
              + Add fallback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
