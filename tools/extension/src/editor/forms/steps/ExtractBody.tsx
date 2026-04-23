import React from 'react';
import type { ExtractAction } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';

interface ExtractBodyProps {
  action: ExtractAction;
  onChange: (next: Partial<ExtractAction>) => void;
  errors: Record<string, string>;
}

const TARGET_OPTIONS = [
  { value: 'text', label: 'Text content' },
  { value: 'attribute', label: 'Attribute' },
  { value: 'html', label: 'HTML' },
  { value: 'url', label: 'Current URL' },
  { value: 'title', label: 'Page title' },
  { value: 'screenshot', label: 'Screenshot' },
];

export function ExtractBody({ action, onChange, errors }: ExtractBodyProps) {
  return (
    <div>
      <SelectField
        label="Target"
        value={action.target}
        onChange={(target) => {
          const next: Partial<ExtractAction> = { target: target as ExtractAction['target'] };
          if (target !== 'attribute') {
            next.attribute = undefined;
          }
          onChange(next);
        }}
        options={TARGET_OPTIONS}
        required
        error={errors['target']}
      />

      {action.target === 'attribute' && (
        <TextField
          label="Attribute name"
          value={action.attribute ?? ''}
          onChange={(attribute) => onChange({ attribute: attribute || undefined })}
          placeholder="e.g. href, data-id, aria-label"
          required
          error={errors['attribute']}
        />
      )}

      <TextField
        label="Output name"
        value={action.outputName}
        onChange={(outputName) => onChange({ outputName })}
        placeholder="myVariable"
        required
        monospace
        hint="Variable name — reference as {{outputName}} later"
        error={errors['outputName']}
      />
    </div>
  );
}
