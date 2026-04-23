import React from 'react';
import type { Validation } from '@portalflow/schema';
import { CheckboxField } from './CheckboxField';
import { SelectField } from './SelectField';
import { TextField } from './TextField';

const VALIDATION_TYPE_OPTIONS = [
  { value: 'url_contains', label: 'URL contains' },
  { value: 'element_visible', label: 'Element visible' },
  { value: 'text_present', label: 'Text present' },
  { value: 'title_contains', label: 'Title contains' },
];

interface ValidationEditorProps {
  value: Validation | undefined;
  onChange: (next: Validation | undefined) => void;
  errors?: Record<string, string>;
}

export function ValidationEditor({ value, onChange, errors = {} }: ValidationEditorProps) {
  const enabled = value !== undefined;

  function handleToggle(checked: boolean) {
    if (!checked) {
      onChange(undefined);
    } else {
      onChange({ type: 'url_contains', value: '' });
    }
  }

  function handleTypeChange(type: string) {
    onChange({ type: type as Validation['type'], value: value?.value ?? '' });
  }

  function handleValueChange(val: string) {
    onChange({ type: value?.type ?? 'url_contains', value: val });
  }

  return (
    <div className="validation-editor">
      <CheckboxField
        label="Use validation"
        checked={enabled}
        onChange={handleToggle}
        hint="Verify a condition after the step completes"
      />
      {enabled && (
        <div className="validation-editor-fields">
          <SelectField
            label="Validation type"
            value={value?.type ?? 'url_contains'}
            onChange={handleTypeChange}
            options={VALIDATION_TYPE_OPTIONS}
            error={errors['type']}
          />
          <TextField
            label="Expected value"
            value={value?.value ?? ''}
            onChange={handleValueChange}
            placeholder="e.g. /dashboard, .success-banner"
            required
            error={errors['value']}
          />
        </div>
      )}
    </div>
  );
}
