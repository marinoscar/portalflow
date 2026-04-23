import React from 'react';
import type { FunctionDefinition, FunctionParameter } from '@portalflow/schema';
import type { EditorAction, ValidationResult } from '../state/editor-state';
import { TextField } from './fields/TextField';
import { TextAreaField } from './fields/TextAreaField';
import { CheckboxField } from './fields/CheckboxField';
import { fieldErrorsForPath } from './errors';

interface FunctionFormProps {
  fn: FunctionDefinition;
  index: number;
  dispatch: React.Dispatch<EditorAction>;
  validation: ValidationResult;
}

export function FunctionForm({ fn, index, dispatch, validation }: FunctionFormProps) {
  const errors = fieldErrorsForPath(validation, ['functions', index]);
  const parameters: FunctionParameter[] = fn.parameters ?? [];

  function updateFn(changes: Partial<Pick<FunctionDefinition, 'name' | 'description' | 'parameters'>>) {
    dispatch({ type: 'UPDATE_FUNCTION', payload: { index, changes } });
  }

  function updateParam(paramIdx: number, changes: Partial<FunctionParameter>) {
    const next = parameters.map((p, i) => (i === paramIdx ? { ...p, ...changes } : p));
    updateFn({ parameters: next });
  }

  function addParam() {
    updateFn({ parameters: [...parameters, { name: '', required: true }] });
  }

  function removeParam(paramIdx: number) {
    updateFn({ parameters: parameters.filter((_, i) => i !== paramIdx) });
  }

  return (
    <div className="form-section">
      <div className="form-section-title">Function #{index + 1}</div>

      <TextField
        label="Name"
        value={fn.name}
        onChange={(name) => updateFn({ name })}
        placeholder="my_function"
        required
        monospace
        error={errors['name']}
      />

      <TextAreaField
        label="Description"
        value={fn.description ?? ''}
        onChange={(description) => updateFn({ description })}
        placeholder="What this function does"
      />

      <div className="form-section">
        <div className="form-section-title">Parameters</div>

        {parameters.map((param, paramIdx) => {
          const paramErrors = fieldErrorsForPath(validation, [
            'functions',
            index,
            'parameters',
            paramIdx,
          ]);
          return (
            <div key={paramIdx} className="param-row">
              <div className="param-row-fields">
                <TextField
                  label="Name"
                  value={param.name}
                  onChange={(name) => updateParam(paramIdx, { name })}
                  placeholder="param_name"
                  required
                  monospace
                  error={paramErrors['name']}
                />
                <TextField
                  label="Description"
                  value={param.description ?? ''}
                  onChange={(description) => updateParam(paramIdx, { description })}
                  placeholder="What this parameter does"
                />
                <TextField
                  label="Default"
                  value={param.default ?? ''}
                  onChange={(def) => updateParam(paramIdx, { default: def || undefined })}
                  placeholder="Default value (optional)"
                />
                <CheckboxField
                  label="Required"
                  checked={param.required ?? true}
                  onChange={(required) => updateParam(paramIdx, { required })}
                />
              </div>
              <button
                type="button"
                className="btn-ghost param-remove"
                onClick={() => removeParam(paramIdx)}
                aria-label="Remove parameter"
              >
                Remove
              </button>
            </div>
          );
        })}

        <button type="button" className="btn-secondary" onClick={addParam}>
          + Add parameter
        </button>
      </div>

      <p className="muted" style={{ marginTop: 8 }}>
        To edit the steps inside this function, select them in the outline.
      </p>
    </div>
  );
}
