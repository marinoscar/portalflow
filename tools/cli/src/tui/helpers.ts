// Shared helpers for the provider TUI
import { getPresetById } from '../llm/provider-kinds.js';

/**
 * Coerce a @clack/prompts text-prompt return value to a trimmed string.
 *
 * `p.text()` returns `undefined` when the user clears the input to empty
 * (the `initialValue` is visual only — the returned value is NOT the
 * placeholder or the initial value when the field is empty). Casting to
 * `string` via `as string` and then calling `.trim()` crashes at runtime.
 *
 * The symbol case covers clack's cancellation sentinel; callers should already
 * have guarded against cancellation with `p.isCancel()` before reaching
 * `asTrimmedString`, so treating a symbol as '' is a safe defensive fallback.
 */
export function asTrimmedString(v: string | symbol | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function providerDisplayName(name: string): string {
  const preset = getPresetById(name);
  if (preset) return preset.label;
  return name;
}

export function defaultModelFor(name: string): string {
  const preset = getPresetById(name);
  if (preset) return preset.defaultModel;
  return '';
}

export function defaultBaseUrlFor(name: string): string {
  const preset = getPresetById(name);
  if (preset) return preset.baseUrl ?? '';
  return '';
}

/**
 * Mask an API key for safe display.
 * Shows first 5 + last 4 chars with asterisks in the middle.
 * If the key is shorter than 12 chars, masks all but the last 4.
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length < 12) {
    const visible = key.slice(-4);
    return `****${visible}`;
  }
  const prefix = key.slice(0, 5);
  const suffix = key.slice(-4);
  const masked = '*'.repeat(Math.min(key.length - 9, 8));
  return `${prefix}${masked}${suffix}`;
}
