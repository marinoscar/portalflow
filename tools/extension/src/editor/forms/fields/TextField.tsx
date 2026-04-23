import React from 'react';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  monospace?: boolean;
  disabled?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  required,
  monospace,
  disabled,
}: TextFieldProps) {
  return (
    <div className="field">
      <span>
        {label}
        {required && <span className="field-required"> *</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={monospace ? { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' } : undefined}
      />
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
