import React from 'react';
import type { Input } from '@portalflow/schema';
import type { EditorAction, ValidationResult } from '../state/editor-state';
import { TextField } from './fields/TextField';
import { TextAreaField } from './fields/TextAreaField';
import { SelectField } from './fields/SelectField';
import { CheckboxField } from './fields/CheckboxField';
import { fieldErrorsForPath } from './errors';

const INPUT_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'secret', label: 'Secret' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
];

const INPUT_SOURCE_OPTIONS = [
  { value: '', label: '— none —' },
  { value: 'literal', label: 'Literal value' },
  { value: 'env', label: 'Environment variable' },
  { value: 'vaultcli', label: 'Vault CLI' },
  { value: 'cli_arg', label: 'CLI argument' },
];

interface InputFormProps {
  input: Input;
  index: number;
  dispatch: React.Dispatch<EditorAction>;
  validation: ValidationResult;
}

export function InputForm({ input, index, dispatch, validation }: InputFormProps) {
  const errors = fieldErrorsForPath(validation, ['inputs', index]);

  function update(changes: Partial<Input>) {
    dispatch({ type: 'UPDATE_INPUT', payload: { index, changes } });
  }

  const showValue = input.source === 'literal' || input.source === 'env';

  return (
    <div className="form-section">
      <div className="form-section-title">Input #{index + 1}</div>

      <TextField
        label="Name"
        value={input.name}
        onChange={(name) => update({ name })}
        placeholder="input_name"
        required
        monospace
        error={errors['name']}
      />

      <SelectField
        label="Type"
        value={input.type}
        onChange={(type) => update({ type: type as Input['type'] })}
        options={INPUT_TYPE_OPTIONS}
        error={errors['type']}
      />

      <CheckboxField
        label="Required"
        checked={input.required ?? true}
        onChange={(required) => update({ required })}
      />

      <SelectField
        label="Source"
        value={input.source ?? ''}
        onChange={(source) =>
          update({ source: source === '' ? undefined : (source as Input['source']) })
        }
        options={INPUT_SOURCE_OPTIONS}
        hint="How this input is resolved at runtime"
        error={errors['source']}
      />

      {showValue && (
        <TextField
          label={input.source === 'env' ? 'Environment variable name' : 'Value'}
          value={input.value ?? ''}
          onChange={(value) => update({ value })}
          placeholder={input.source === 'env' ? 'MY_ENV_VAR' : 'literal value'}
          error={errors['value']}
        />
      )}

      <TextAreaField
        label="Description"
        value={input.description ?? ''}
        onChange={(description) => update({ description })}
        placeholder="What this input is used for"
      />
    </div>
  );
}
