import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectSingletonLock,
  clearSingletonFiles,
  preflightPersistentLaunch,
} from '../src/browser/persistent-launch.js';

/**
 * These tests exercise the persistent-launch preflight helpers against
 * a temporary user data directory on disk. They rely on Linux-style
 * symlink semantics because that's how Chrome actually writes its
 * SingletonLock file on the target platform (Ubuntu-first per VISION.md).
 */

describe('persistent-launch helpers', () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'portalflow-persistent-test-'));
  });

  afterEach(() => {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Non-fatal: the next OS cleanup will take care of it.
    }
  });

  // ---------------------------------------------------------------------
  // inspectSingletonLock
  // ---------------------------------------------------------------------

  describe('inspectSingletonLock', () => {
    it('returns null when no SingletonLock file exists', () => {
      expect(inspectSingletonLock(userDataDir)).toBeNull();
    });

    it('returns stale: true when SingletonLock is a regular file (non-Linux / corrupt)', () => {
      writeFileSync(join(userDataDir, 'SingletonLock'), 'not-a-symlink');
      const result = inspectSingletonLock(userDataDir);
      expect(result).not.toBeNull();
      expect(result!.stale).toBe(true);
    });

    it('returns stale: true when the symlink points to a dead pid', () => {
      // Pick a pid we're confident is not running: 999999 is beyond the
      // kernel's usual pid_max on stock kernels, and even when it isn't
      // no sane test host has 999999 processes.
      symlinkSync('fakehost-999999', join(userDataDir, 'SingletonLock'));
      const result = inspectSingletonLock(userDataDir);
      expect(result).not.toBeNull();
      expect(result!.stale).toBe(true);
      expect(result!.pid).toBe(999999);
    });

    it('returns stale: false when the symlink points to a live pid (this process)', () => {
      const livePid = process.pid;
      symlinkSync(`testhost-${livePid}`, join(userDataDir, 'SingletonLock'));
      const result = inspectSingletonLock(userDataDir);
      expect(result).not.toBeNull();
      expect(result!.stale).toBe(false);
      expect(result!.pid).toBe(livePid);
    });

    it('returns stale: true when the symlink target is malformed (no pid)', () => {
      symlinkSync('nohypen', join(userDataDir, 'SingletonLock'));
      const result = inspectSingletonLock(userDataDir);
      expect(result!.stale).toBe(true);
    });

    it('handles hyphenated hostnames correctly (uses LAST dash)', () => {
      // hostname "my-linux-box", pid same as current process
      const livePid = process.pid;
      symlinkSync(`my-linux-box-${livePid}`, join(userDataDir, 'SingletonLock'));
      const result = inspectSingletonLock(userDataDir);
      expect(result!.pid).toBe(livePid);
      expect(result!.stale).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // clearSingletonFiles
  // ---------------------------------------------------------------------

  describe('clearSingletonFiles', () => {
    it('removes all three Singleton files when present', () => {
      symlinkSync('host-1', join(userDataDir, 'SingletonLock'));
      writeFileSync(join(userDataDir, 'SingletonCookie'), 'cookie');
      writeFileSync(join(userDataDir, 'SingletonSocket'), 'socket');

      const removed = clearSingletonFiles(userDataDir);

      expect(removed).toContain('SingletonLock');
      expect(removed).toContain('SingletonCookie');
      expect(removed).toContain('SingletonSocket');
      expect(existsSync(join(userDataDir, 'SingletonLock'))).toBe(false);
      expect(existsSync(join(userDataDir, 'SingletonCookie'))).toBe(false);
      expect(existsSync(join(userDataDir, 'SingletonSocket'))).toBe(false);
    });

    it('silently skips files that are not present', () => {
      writeFileSync(join(userDataDir, 'SingletonLock'), 'x');
      const removed = clearSingletonFiles(userDataDir);
      expect(removed).toEqual(['SingletonLock']);
    });

    it('returns an empty array when no Singleton files exist', () => {
      expect(clearSingletonFiles(userDataDir)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // preflightPersistentLaunch
  // ---------------------------------------------------------------------

  describe('preflightPersistentLaunch', () => {
    it('throws when the user data directory does not exist', () => {
      expect(() =>
        preflightPersistentLaunch({
          userDataDir: join(userDataDir, 'does-not-exist'),
        }),
      ).toThrow(/user data directory does not exist/);
    });

    it('throws when the profile sub-directory does not exist', () => {
      expect(() =>
        preflightPersistentLaunch({
          userDataDir,
          profileDirectory: 'Profile 99',
        }),
      ).toThrow(/profile sub-directory does not exist/);
    });

    it('succeeds when the profile sub-directory exists', () => {
      mkdirSync(join(userDataDir, 'Default'));
      expect(() =>
        preflightPersistentLaunch({
          userDataDir,
          profileDirectory: 'Default',
        }),
      ).not.toThrow();
    });

    it('throws with a clear message when a live Chrome is holding the lock', () => {
      const livePid = process.pid;
      symlinkSync(`testhost-${livePid}`, join(userDataDir, 'SingletonLock'));

      expect(() =>
        preflightPersistentLaunch({ userDataDir }),
      ).toThrow(new RegExp(`currently in use by Chrome process ${livePid}`));
    });

    it('clears stale singleton files and succeeds', () => {
      symlinkSync('fakehost-999999', join(userDataDir, 'SingletonLock'));
      writeFileSync(join(userDataDir, 'SingletonCookie'), 'stale');
      writeFileSync(join(userDataDir, 'SingletonSocket'), 'stale');

      expect(() =>
        preflightPersistentLaunch({ userDataDir }),
      ).not.toThrow();

      // Stale singleton files should be gone after preflight.
      expect(existsSync(join(userDataDir, 'SingletonLock'))).toBe(false);
      expect(existsSync(join(userDataDir, 'SingletonCookie'))).toBe(false);
      expect(existsSync(join(userDataDir, 'SingletonSocket'))).toBe(false);
    });
  });
});
