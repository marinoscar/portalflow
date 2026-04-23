import React from 'react';
import type { Automation } from '@portalflow/schema';
import type { EditorAction } from '../state/editor-state';
import type { ValidationResult } from '../state/editor-state';
import { TextField } from './fields/TextField';
import { TextAreaField } from './fields/TextAreaField';
import { fieldErrorsForPath } from './errors';

interface MetadataFormProps {
  automation: Automation;
  dispatch: React.Dispatch<EditorAction>;
  validation: ValidationResult;
}

export function MetadataForm({ automation, dispatch, validation }: MetadataFormProps) {
  const errors = fieldErrorsForPath(validation, []);

  function update(changes: Partial<Pick<Automation, 'name' | 'description' | 'goal' | 'version'>>) {
    dispatch({ type: 'UPDATE_METADATA', payload: changes });
  }

  return (
    <div className="form-section">
      <div className="form-section-title">Automation metadata</div>

      <TextField
        label="Name"
        value={automation.name}
        onChange={(name) => update({ name })}
        placeholder="My automation"
        required
        error={errors['name']}
      />

      <TextField
        label="Version"
        value={automation.version ?? ''}
        onChange={(version) => update({ version })}
        placeholder="1.0.0"
      />

      <TextAreaField
        label="Goal"
        value={automation.goal ?? ''}
        onChange={(goal) => update({ goal })}
        required
        hint="What should this automation accomplish?"
        error={errors['goal']}
      />

      <TextAreaField
        label="Description"
        value={automation.description ?? ''}
        onChange={(description) => update({ description })}
        placeholder="Optional longer description"
      />

      <div className="field">
        <span>Automation ID</span>
        <input
          type="text"
          value={automation.id}
          readOnly
          disabled
          style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: '#64748b' }}
        />
        <span className="field-hint">Auto-generated; edit in JSON export if needed</span>
      </div>
    </div>
  );
}
