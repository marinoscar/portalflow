import React from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  hint?: string;
  required?: boolean;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  required,
}: SelectFieldProps) {
  return (
    <div className="field">
      <span>
        {label}
        {required && <span className="field-required"> *</span>}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
