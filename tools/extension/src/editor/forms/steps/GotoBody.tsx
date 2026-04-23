import React, { useState } from 'react';
import type { GotoAction, Automation } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';
import { CheckboxField } from '../fields/CheckboxField';

interface GotoBodyProps {
  action: GotoAction;
  onChange: (next: Partial<GotoAction>) => void;
  errors: Record<string, string>;
  automation: Automation;
}

export function GotoBody({ action, onChange, errors, automation }: GotoBodyProps) {
  const stepOptions = automation.steps.map((s) => ({
    value: s.id,
    label: s.name || s.id,
  }));

  // Detect if the current value is a template expression (can't be in the select list)
  const isTemplate = /\{\{[^}]+\}\}/.test(action.targetStepId);
  const [rawMode, setRawMode] = useState(isTemplate);

  // Check if current value is in the list (for select)
  const inList = stepOptions.some((o) => o.value === action.targetStepId);
  const showRawField = rawMode || (!inList && action.targetStepId !== '');

  return (
    <div>
      {!showRawField ? (
        <SelectField
          label="Target step"
          value={action.targetStepId}
          onChange={(targetStepId) => onChange({ targetStepId })}
          options={[{ value: '', label: '-- select --' }, ...stepOptions]}
          required
          hint="Must be a top-level step id."
          error={errors['targetStepId']}
        />
      ) : (
        <TextField
          label="Target step id (raw)"
          value={action.targetStepId}
          onChange={(targetStepId) => onChange({ targetStepId })}
          placeholder="stepId or {{templateVar}}"
          monospace
          required
          hint="For templated ids like {{someStepVar}}. Non-templated ids are not validated against the outline in raw mode."
          error={errors['targetStepId']}
        />
      )}

      <CheckboxField
        label="Advanced: enter raw id"
        checked={showRawField}
        onChange={(checked) => {
          setRawMode(checked);
          if (!checked) {
            // Reset to first available step when switching back to select
            const first = stepOptions[0]?.value ?? '';
            onChange({ targetStepId: first });
          }
        }}
        hint="Enable to use template expressions like {{someStepVar}} as the jump target."
      />
    </div>
  );
}
