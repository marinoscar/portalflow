import React from 'react';

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function CheckboxField({ label, checked, onChange, hint }: CheckboxFieldProps) {
  return (
    <div className="field field--checkbox">
      <label className="field-checkbox-label">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="field-checkbox-text">{label}</span>
      </label>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}
