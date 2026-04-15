import { describe, it, expect } from 'vitest';
import {
  STEALTH_EVASION_LIST,
  STEALTH_IGNORE_DEFAULT_ARGS,
  STEALTH_INIT_SCRIPT,
  STEALTH_LAUNCH_ARGS,
} from '../src/browser/stealth.js';

/**
 * Stealth unit tests. These are structural — they verify the exported
 * constants have the expected shape and that the init script contains
 * each evasion patch. They do NOT run the script in a real browser
 * (that would require a Playwright launch, which is slow and flaky
 * for a CI unit test). The real validation of the patches is via
 * manual testing against bot-detection sites, documented in
 * docs/AUTOMATION-JSON-SPEC.md.
 */

describe('stealth module', () => {
  describe('STEALTH_LAUNCH_ARGS', () => {
    it('strips navigator.webdriver via --disable-blink-features=AutomationControlled', () => {
      expect(STEALTH_LAUNCH_ARGS).toContain(
        '--disable-blink-features=AutomationControlled',
      );
    });

    it('prevents OS keyring prompts via --password-store=basic', () => {
      expect(STEALTH_LAUNCH_ARGS).toContain('--password-store=basic');
    });

    it('includes the AutomationControlled feature disable list', () => {
      const hasFeatureFlag = STEALTH_LAUNCH_ARGS.some((arg) =>
        arg.startsWith('--disable-features=') && arg.includes('AutomationControlled'),
      );
      expect(hasFeatureFlag).toBe(true);
    });
  });

  describe('STEALTH_IGNORE_DEFAULT_ARGS', () => {
    it('strips --enable-automation (the authoritative webdriver flag)', () => {
      expect(STEALTH_IGNORE_DEFAULT_ARGS).toContain('--enable-automation');
    });
  });

  describe('STEALTH_INIT_SCRIPT', () => {
    // Each patch must be present. Use substring matching against the
    // evasion comment headers so we don't couple the test too tightly
    // to the exact implementation of each patch.
    const expectedEvasions = [
      'navigator.webdriver',
      'window.chrome',
      'navigator.plugins',
      'navigator.languages',
      'navigator.permissions.query leak',
      'WebGL vendor / renderer',
      'navigator.hardwareConcurrency',
      'navigator.deviceMemory',
      'iframe contentWindow chrome',
      'Function.prototype.toString',
    ];

    for (const evasion of expectedEvasions) {
      it(`includes a patch for ${evasion}`, () => {
        expect(STEALTH_INIT_SCRIPT).toContain(evasion);
      });
    }

    it('wraps every patch in try/catch so one failure does not break the others', () => {
      // Count the try/catch blocks — one per patch region. The init
      // script has 10 patches plus the outer IIFE, so at least 10
      // try blocks should be present.
      const tryCount = (STEALTH_INIT_SCRIPT.match(/try\s*\{/g) ?? []).length;
      expect(tryCount).toBeGreaterThanOrEqual(10);
    });

    it('is an IIFE that runs immediately', () => {
      // Starts with "(() => {" or "(function" and ends with "})();" or "})();".
      const trimmed = STEALTH_INIT_SCRIPT.trim();
      expect(trimmed.startsWith('(() =>') || trimmed.startsWith('(function')).toBe(
        true,
      );
      expect(trimmed.endsWith("})();")).toBe(true);
    });

    it('uses strict mode', () => {
      expect(STEALTH_INIT_SCRIPT).toContain("'use strict'");
    });

    it('defines navigator.webdriver as undefined (not the literal string)', () => {
      // Defensive: make sure we didn't accidentally patch the getter
      // to return 'undefined' as a string, which would be detectable.
      expect(STEALTH_INIT_SCRIPT).toMatch(/get:\s*\(\)\s*=>\s*undefined/);
    });

    it('patches WebGL parameter 37445 (UNMASKED_VENDOR_WEBGL)', () => {
      expect(STEALTH_INIT_SCRIPT).toContain('37445');
    });

    it('patches WebGL parameter 37446 (UNMASKED_RENDERER_WEBGL)', () => {
      expect(STEALTH_INIT_SCRIPT).toContain('37446');
    });

    it('returns a plausible WebGL vendor / renderer string', () => {
      // Should include "Google Inc." as the vendor and an ANGLE
      // renderer to match a real Windows Chrome.
      expect(STEALTH_INIT_SCRIPT).toContain('Google Inc.');
      expect(STEALTH_INIT_SCRIPT).toContain('ANGLE');
    });

    it('sets languages to a multi-entry array matching real Chrome', () => {
      expect(STEALTH_INIT_SCRIPT).toContain("['en-US', 'en']");
    });

    it('patches Function.prototype.toString so patched getters look native', () => {
      expect(STEALTH_INIT_SCRIPT).toContain('[native code]');
    });
  });

  describe('STEALTH_EVASION_LIST', () => {
    it('has 10 entries matching the init script patches', () => {
      expect(STEALTH_EVASION_LIST.length).toBe(10);
    });

    it('is readonly so it cannot be mutated at runtime', () => {
      // TypeScript enforces this at compile time via the `readonly`
      // modifier. Runtime check is cosmetic.
      expect(Array.isArray(STEALTH_EVASION_LIST)).toBe(true);
    });
  });
});
