import React from 'react';
import type { CallAction, Automation } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { KeyValueList } from '../fields/KeyValueList';

interface CallBodyProps {
  action: CallAction;
  onChange: (next: Partial<CallAction>) => void;
  errors: Record<string, string>;
  automation: Automation;
}

export function CallBody({ action, onChange, errors, automation }: CallBodyProps) {
  const functions = automation.functions ?? [];
  const functionOptions = functions.map((f) => ({ value: f.name, label: f.name }));
  const hasFunctions = functionOptions.length > 0;

  return (
    <div>
      {hasFunctions ? (
        <SelectField
          label="Function"
          value={action.function}
          onChange={(fn) => onChange({ function: fn })}
          options={functionOptions}
          required
          error={errors['function']}
        />
      ) : (
        <div className="field">
          <span>Function</span>
          <select disabled value="">
            <option value="">No functions defined</option>
          </select>
          <span className="field-hint">Define a function in the outline first.</span>
        </div>
      )}

      <KeyValueList
        label="Args"
        value={action.args ?? {}}
        onChange={(args) => onChange({ args: Object.keys(args).length ? args : undefined })}
        keyPlaceholder="parameter name"
        valuePlaceholder="value"
        hint="Argument values support {{variables}}"
      />
    </div>
  );
}
