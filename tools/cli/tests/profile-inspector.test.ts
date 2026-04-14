import { describe, it, expect } from 'vitest';
import {
  discoverBrowserProfiles,
  formatProfileLine,
  __test__,
  type BrowserProfile,
} from '../src/browser/profile-inspector.js';

describe('profile-inspector', () => {
  describe('Local State parsing', () => {
    it('parses Chrome Local State JSON shape', () => {
      const json = JSON.stringify({
        profile: {
          info_cache: {
            Default: {
              name: 'Personal',
              user_name: 'oscar@marin.cr',
              gaia_name: 'Oscar Marin',
            },
            'Profile 1': {
              name: 'Work',
              user_name: 'oscar@work.example',
            },
          },
        },
      });
      const parsed = __test__.readLocalStateContent(json);
      expect(parsed).not.toBeNull();
      expect(parsed?.profile?.info_cache?.['Default']?.name).toBe('Personal');
      expect(parsed?.profile?.info_cache?.['Profile 1']?.user_name).toBe(
        'oscar@work.example',
      );
    });

    it('returns null for non-JSON content', () => {
      expect(__test__.readLocalStateContent('not json')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(__test__.readLocalStateContent('')).toBeNull();
    });

    it('returns the parsed object even when the profile cache is missing', () => {
      const parsed = __test__.readLocalStateContent('{}');
      expect(parsed).toEqual({});
    });
  });

  describe('display name derivation', () => {
    it('prefers the explicit name field', () => {
      expect(
        __test__.deriveDisplayName('Profile 1', { name: 'Work', gaia_name: 'Oscar' }),
      ).toBe('Work');
    });

    it('falls back to gaia_name when name is missing', () => {
      expect(
        __test__.deriveDisplayName('Profile 1', { gaia_name: 'Oscar Marin' }),
      ).toBe('Oscar Marin');
    });

    it('falls back to "Default" for the Default directory when no metadata exists', () => {
      expect(__test__.deriveDisplayName('Default', undefined)).toBe('Default');
    });

    it('falls back to the directory name for non-Default directories', () => {
      expect(__test__.deriveDisplayName('Profile 3', undefined)).toBe('Profile 3');
    });

    it('strips whitespace-only names', () => {
      expect(__test__.deriveDisplayName('Default', { name: '   ' })).toBe('Default');
    });
  });

  describe('email derivation', () => {
    it('returns the user_name when it looks like an email', () => {
      expect(__test__.deriveEmail({ user_name: 'oscar@marin.cr' })).toBe(
        'oscar@marin.cr',
      );
    });

    it('returns undefined when there is no @ sign', () => {
      expect(__test__.deriveEmail({ user_name: 'just-a-name' })).toBeUndefined();
    });

    it('returns undefined when user_name is missing', () => {
      expect(__test__.deriveEmail({})).toBeUndefined();
    });
  });

  describe('formatProfileLine', () => {
    it('renders the full profile line with email', () => {
      const profile: BrowserProfile = {
        browser: 'Google Chrome',
        channel: 'chrome',
        userDataDir: '/home/me/.config/google-chrome',
        profileDirectory: 'Default',
        displayName: 'Personal',
        email: 'oscar@marin.cr',
      };
      expect(formatProfileLine(profile)).toBe(
        'Google Chrome / Personal — oscar@marin.cr  [Default]',
      );
    });

    it('omits the email when not set', () => {
      const profile: BrowserProfile = {
        browser: 'Brave',
        channel: 'chrome',
        userDataDir: '/home/me/.config/BraveSoftware/Brave-Browser',
        profileDirectory: 'Profile 2',
        displayName: 'Privacy',
      };
      expect(formatProfileLine(profile)).toBe('Brave / Privacy  [Profile 2]');
    });
  });

  describe('discoverBrowserProfiles', () => {
    it('returns an array (may be empty depending on the host)', () => {
      const result = discoverBrowserProfiles();
      expect(Array.isArray(result)).toBe(true);
      // Every returned entry should have all the required fields populated.
      for (const p of result) {
        expect(p.browser).toBeTypeOf('string');
        expect(p.channel).toBeTypeOf('string');
        expect(p.userDataDir).toBeTypeOf('string');
        expect(p.profileDirectory).toBeTypeOf('string');
        expect(p.displayName).toBeTypeOf('string');
      }
    });
  });
});
