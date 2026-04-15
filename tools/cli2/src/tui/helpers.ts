// Shared helpers for the provider TUI
import { getPresetById } from '../llm/provider-kinds.js';

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
