import React from 'react';

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  hint?: string;
  required?: boolean;
  suffix?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  error,
  hint,
  required,
  suffix,
}: NumberFieldProps) {
  return (
    <div className="field">
      <span>
        {label}
        {required && <span className="field-required"> *</span>}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={value === null ? '' : value}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? null : Number(raw));
          }}
          min={min}
          max={max}
          step={step}
          style={{ flex: 1 }}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </div>
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
