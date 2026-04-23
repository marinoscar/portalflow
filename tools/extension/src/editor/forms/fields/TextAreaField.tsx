import React, { useEffect, useRef } from 'react';

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  rows?: number;
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  required,
  rows = 3,
}: TextAreaFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow to content
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="field">
      <span>
        {label}
        {required && <span className="field-required"> *</span>}
      </span>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={{ resize: 'none', overflow: 'hidden' }}
      />
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
