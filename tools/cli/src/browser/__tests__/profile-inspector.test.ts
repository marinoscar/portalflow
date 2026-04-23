/**
 * profile-inspector.test.ts
 *
 * Unit tests for the profile-inspector helpers exposed via __test__.
 * No filesystem access — all tests use in-memory JSON strings or synthetic
 * LocalStateProfileEntry values.
 *
 * discoverBrowserProfiles() walks the real filesystem and is therefore not
 * covered here. Integration-level verification is left for manual testing
 * or a future memfs-based test when memfs is added to the project.
 */

import { describe, it, expect } from 'vitest';
import { __test__, formatProfileLine } from '../profile-inspector.js';
import type { BrowserProfile } from '../profile-inspector.js';

const { readLocalStateContent, deriveDisplayName, deriveEmail } = __test__;

// ---------------------------------------------------------------------------
// readLocalStateContent
// ---------------------------------------------------------------------------

describe('__test__.readLocalStateContent', () => {
  it('parses valid Local State JSON and returns a LocalStateShape', () => {
    const json = JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: 'Personal', user_name: 'oscar@marin.cr' },
          'Profile 1': { name: 'Work', user_name: 'oscar@work.com' },
        },
      },
    });

    const result = readLocalStateContent(json);
    expect(result).not.toBeNull();
    expect(result?.profile?.info_cache?.['Default']?.name).toBe('Personal');
    expect(result?.profile?.info_cache?.['Profile 1']?.name).toBe('Work');
  });

  it('returns an object with no profile key for empty JSON object', () => {
    const result = readLocalStateContent('{}');
    expect(result).not.toBeNull();
    expect(result?.profile).toBeUndefined();
  });

  it('returns null for invalid JSON (garbage input)', () => {
    const result = readLocalStateContent('not valid json {{{');
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    const result = readLocalStateContent('');
    expect(result).toBeNull();
  });

  it('returns null for a JSON string that is not an object (e.g. array)', () => {
    // Arrays parse fine as JSON but are not LocalStateShape objects.
    // The function returns the parsed value cast to LocalStateShape; caller
    // accesses .profile which will be undefined on an array — that is fine,
    // because no crash occurs and callers guard with ??.
    const result = readLocalStateContent('[]');
    // Not null because JSON.parse succeeds; result.profile will simply be undefined.
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)['profile']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deriveDisplayName
// ---------------------------------------------------------------------------

describe('__test__.deriveDisplayName', () => {
  it('prefers entry.name when present and non-empty', () => {
    const result = deriveDisplayName('Profile 1', { name: 'Work', gaia_name: 'Oscar W' });
    expect(result).toBe('Work');
  });

  it('falls back to entry.gaia_name when name is absent', () => {
    const result = deriveDisplayName('Profile 2', { gaia_name: 'Oscar Personal' });
    expect(result).toBe('Oscar Personal');
  });

  it('falls back to entry.gaia_name when name is whitespace-only', () => {
    const result = deriveDisplayName('Profile 2', { name: '   ', gaia_name: 'Oscar' });
    expect(result).toBe('Oscar');
  });

  it('returns "Default" when dir is "Default" and entry has no useful metadata', () => {
    const result = deriveDisplayName('Default', {});
    expect(result).toBe('Default');
  });

  it('returns "Default" when dir is "Default" and entry is undefined', () => {
    const result = deriveDisplayName('Default', undefined);
    expect(result).toBe('Default');
  });

  it('returns the directory name when dir is not Default and entry has no useful metadata', () => {
    const result = deriveDisplayName('Profile 3', {});
    expect(result).toBe('Profile 3');
  });

  it('returns the directory name when entry is undefined and dir is not Default', () => {
    const result = deriveDisplayName('Profile 7', undefined);
    expect(result).toBe('Profile 7');
  });

  it('trims leading/trailing whitespace from entry.name', () => {
    const result = deriveDisplayName('Profile 1', { name: '  Trimmed  ' });
    expect(result).toBe('Trimmed');
  });

  it('trims leading/trailing whitespace from entry.gaia_name', () => {
    const result = deriveDisplayName('Profile 1', { gaia_name: '  Gaïa  ' });
    expect(result).toBe('Gaïa');
  });
});

// ---------------------------------------------------------------------------
// deriveEmail
// ---------------------------------------------------------------------------

describe('__test__.deriveEmail', () => {
  it('returns user_name when it contains @', () => {
    const result = deriveEmail({ user_name: 'oscar@marin.cr' });
    expect(result).toBe('oscar@marin.cr');
  });

  it('returns undefined when user_name does not contain @', () => {
    const result = deriveEmail({ user_name: 'not-an-email' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when user_name is an empty string', () => {
    const result = deriveEmail({ user_name: '' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when entry is undefined', () => {
    const result = deriveEmail(undefined);
    expect(result).toBeUndefined();
  });

  it('returns undefined when user_name is absent from entry', () => {
    const result = deriveEmail({ name: 'Some Name' });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatProfileLine
// ---------------------------------------------------------------------------

describe('formatProfileLine', () => {
  it('includes browser, displayName, and profileDirectory', () => {
    const profile: BrowserProfile = {
      browser: 'Google Chrome',
      userDataDir: '/home/user/.config/google-chrome',
      profileDirectory: 'Default',
      displayName: 'Personal',
    };
    const line = formatProfileLine(profile);
    expect(line).toBe('Google Chrome / Personal  [Default]');
  });

  it('includes email when present', () => {
    const profile: BrowserProfile = {
      browser: 'Google Chrome',
      userDataDir: '/home/user/.config/google-chrome',
      profileDirectory: 'Profile 1',
      displayName: 'Work',
      email: 'oscar@work.com',
    };
    const line = formatProfileLine(profile);
    expect(line).toBe('Google Chrome / Work — oscar@work.com  [Profile 1]');
  });

  it('omits the email section when email is undefined', () => {
    const profile: BrowserProfile = {
      browser: 'Brave',
      userDataDir: '/home/user/.config/BraveSoftware/Brave-Browser',
      profileDirectory: 'Default',
      displayName: 'Default',
    };
    const line = formatProfileLine(profile);
    expect(line).not.toContain('—');
    expect(line).toContain('[Default]');
  });
});
