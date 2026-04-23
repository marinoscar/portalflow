import React from 'react';
import type { WaitAction } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';
import { NumberField } from '../fields/NumberField';

interface WaitBodyProps {
  action: WaitAction;
  onChange: (next: Partial<WaitAction>) => void;
  errors: Record<string, string>;
}

const CONDITION_OPTIONS = [
  { value: 'selector', label: 'Selector visible' },
  { value: 'navigation', label: 'Navigation complete' },
  { value: 'delay', label: 'Delay' },
  { value: 'network_idle', label: 'Network idle' },
];

function valuePlaceholder(condition: WaitAction['condition']): string {
  switch (condition) {
    case 'selector':
      return 'CSS selector';
    case 'navigation':
      return 'URL substring (optional)';
    case 'delay':
      return 'milliseconds as string, e.g. 2000';
    default:
      return '';
  }
}

function valueRequired(condition: WaitAction['condition']): boolean {
  return condition === 'selector' || condition === 'delay';
}

function showValue(condition: WaitAction['condition']): boolean {
  return condition !== 'network_idle';
}

export function WaitBody({ action, onChange, errors }: WaitBodyProps) {
  return (
    <div>
      <SelectField
        label="Condition"
        value={action.condition}
        onChange={(condition) =>
          onChange({ condition: condition as WaitAction['condition'], value: undefined })
        }
        options={CONDITION_OPTIONS}
        required
        error={errors['condition']}
      />

      {showValue(action.condition) && (
        <TextField
          label="Value"
          value={action.value ?? ''}
          onChange={(value) => onChange({ value: value || undefined })}
          placeholder={valuePlaceholder(action.condition)}
          required={valueRequired(action.condition)}
          monospace={action.condition === 'selector'}
          error={errors['value']}
        />
      )}

      <NumberField
        label="Timeout"
        value={action.timeout ?? null}
        onChange={(v) => onChange({ timeout: v ?? undefined })}
        min={0}
        suffix="ms"
        hint="Overrides step timeout for this wait only"
        error={errors['timeout']}
      />
    </div>
  );
}
