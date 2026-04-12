// Shared helpers for the provider TUI

export type SupportedProvider = 'anthropic' | 'openai';

export const SUPPORTED_PROVIDERS: SupportedProvider[] = ['anthropic', 'openai'];

export function providerDisplayName(name: string): string {
  switch (name) {
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    default:
      return name;
  }
}

export function defaultModelFor(name: string): string {
  switch (name) {
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'openai':
      return 'gpt-4o';
    default:
      return '';
  }
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
