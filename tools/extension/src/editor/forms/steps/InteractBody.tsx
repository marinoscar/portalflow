import React from 'react';
import type { InteractAction } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';
import { TemplateHint } from '../fields/TemplateHint';

interface InteractBodyProps {
  action: InteractAction;
  onChange: (next: Partial<InteractAction>) => void;
  errors: Record<string, string>;
}

const INTERACTION_OPTIONS = [
  { value: 'click', label: 'Click' },
  { value: 'type', label: 'Type' },
  { value: 'select', label: 'Select' },
  { value: 'check', label: 'Check' },
  { value: 'uncheck', label: 'Uncheck' },
  { value: 'hover', label: 'Hover' },
  { value: 'focus', label: 'Focus' },
];

// Interactions where value is relevant
const INTERACTIONS_WITH_VALUE = new Set(['type', 'select']);
// Interactions where inputRef is relevant (credentials pattern)
const INTERACTIONS_WITH_INPUT_REF = new Set(['type']);

export function InteractBody({ action, onChange, errors }: InteractBodyProps) {
  const showValue = INTERACTIONS_WITH_VALUE.has(action.interaction);
  const showInputRef = INTERACTIONS_WITH_INPUT_REF.has(action.interaction);

  function handleInteractionChange(interaction: string) {
    const next: Partial<InteractAction> = {
      interaction: interaction as InteractAction['interaction'],
    };
    // Clear fields that don't apply to the new interaction type
    if (!INTERACTIONS_WITH_VALUE.has(interaction)) {
      next.value = undefined;
    }
    if (!INTERACTIONS_WITH_INPUT_REF.has(interaction)) {
      next.inputRef = undefined;
    }
    onChange(next);
  }

  return (
    <div>
      <SelectField
        label="Interaction"
        value={action.interaction}
        onChange={handleInteractionChange}
        options={INTERACTION_OPTIONS}
        required
        error={errors['interaction']}
      />

      {showValue && (
        <>
          <TextField
            label="Value"
            value={action.value ?? ''}
            onChange={(value) => onChange({ value: value || undefined })}
            placeholder={action.interaction === 'select' ? 'Option value or label' : 'Text to type'}
            error={errors['value']}
          />
          <TemplateHint />
        </>
      )}

      {showInputRef && (
        <>
          <TextField
            label="Input ref"
            value={action.inputRef ?? ''}
            onChange={(inputRef) => onChange({ inputRef: inputRef || undefined })}
            placeholder="variableName"
            monospace
            error={errors['inputRef']}
            hint="References a variable — prefer this over value for secrets."
          />
        </>
      )}
    </div>
  );
}
