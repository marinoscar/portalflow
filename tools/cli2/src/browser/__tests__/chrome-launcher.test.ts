/**
 * chrome-launcher.test.ts
 *
 * Unit tests for detectChromeBinary, launchChrome, and waitForExtensionHandshake.
 * No real Chrome is spawned — child_process.spawn is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Module-level mocks — must be set up before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    accessSync: vi.fn(() => { /* no-op by default */ }),
    constants: actual.constants,
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(() => ''),
    spawn: vi.fn(() => {
      const proc = { pid: 12345, unref: vi.fn() };
      return proc;
    }),
  };
});

// Import the mocked modules
import { existsSync, accessSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

// Import the module under test after mocks are set up
import {
  detectChromeBinary,
  launchChrome,
  waitForExtensionHandshake,
} from '../chrome-launcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockExistsSync = vi.mocked(existsSync);
const mockAccessSync = vi.mocked(accessSync);
const mockExecSync = vi.mocked(execSync);
const mockSpawn = vi.mocked(spawn);

function resetMocks(): void {
  mockExistsSync.mockReset().mockReturnValue(false);
  mockAccessSync.mockReset(); // no-op = accessible
  mockExecSync.mockReset().mockReturnValue('');
  mockSpawn.mockReset().mockReturnValue({
    pid: 12345,
    unref: vi.fn(),
  } as unknown as ReturnType<typeof spawn>);
}

// ---------------------------------------------------------------------------
// detectChromeBinary — override path
// ---------------------------------------------------------------------------

describe('detectChromeBinary — override path', () => {
  beforeEach(resetMocks);

  it('returns the override path when it exists and is executable', async () => {
    mockExistsSync.mockReturnValue(true);
    mockAccessSync.mockReturnValue(undefined); // no throw = executable

    const result = await detectChromeBinary('/usr/bin/custom-chrome', 'linux');
    expect(result).toBe('/usr/bin/custom-chrome');
  });

  it('throws when the override path does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(detectChromeBinary('/usr/bin/nonexistent', 'linux')).rejects.toThrow(
      'Configured chromeBinary does not exist or is not executable: /usr/bin/nonexistent',
    );
  });

  it('throws when the override path exists but is not executable', async () => {
    mockExistsSync.mockReturnValue(true);
    mockAccessSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    await expect(detectChromeBinary('/usr/bin/not-executable', 'linux')).rejects.toThrow(
      'Configured chromeBinary does not exist or is not executable: /usr/bin/not-executable',
    );
  });
});

// ---------------------------------------------------------------------------
// detectChromeBinary — Linux detection
// ---------------------------------------------------------------------------

describe('detectChromeBinary — Linux detection', () => {
  beforeEach(resetMocks);

  it('finds google-chrome-stable first when it is in PATH', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('google-chrome-stable')) {
        return '/usr/bin/google-chrome-stable';
      }
      return '';
    });

    const result = await detectChromeBinary(undefined, 'linux');
    expect(result).toBe('/usr/bin/google-chrome-stable');
  });

  it('falls back to google-chrome when google-chrome-stable is not found', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('google-chrome-stable')) return '';
      if (typeof cmd === 'string' && cmd.includes('google-chrome') && !cmd.includes('stable')) {
        return '/usr/bin/google-chrome';
      }
      return '';
    });

    const result = await detectChromeBinary(undefined, 'linux');
    expect(result).toBe('/usr/bin/google-chrome');
  });

  it('falls back to chromium when google-chrome is not found', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('chromium') && !cmd.includes('browser')) {
        return '/usr/bin/chromium';
      }
      return '';
    });

    const result = await detectChromeBinary(undefined, 'linux');
    expect(result).toBe('/usr/bin/chromium');
  });

  it('falls back to chromium-browser as last resort', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('chromium-browser')) {
        return '/usr/bin/chromium-browser';
      }
      return '';
    });

    const result = await detectChromeBinary(undefined, 'linux');
    expect(result).toBe('/usr/bin/chromium-browser');
  });

  it('throws when no Chrome binary is found on Linux', async () => {
    mockExecSync.mockReturnValue('');

    await expect(detectChromeBinary(undefined, 'linux')).rejects.toThrow(
      'Could not find Chrome. Install Chrome or set extension.chromeBinary in ~/.portalflow/config.json',
    );
  });
});

// ---------------------------------------------------------------------------
// detectChromeBinary — macOS detection
// ---------------------------------------------------------------------------

describe('detectChromeBinary — macOS (darwin) detection', () => {
  beforeEach(resetMocks);

  it('finds Google Chrome.app on macOS', async () => {
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    mockExistsSync.mockImplementation((p) => p === chromePath);
    mockAccessSync.mockReturnValue(undefined);

    const result = await detectChromeBinary(undefined, 'darwin');
    expect(result).toBe(chromePath);
  });

  it('falls back to Chromium.app on macOS', async () => {
    const chromiumPath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    mockExistsSync.mockImplementation((p) => p === chromiumPath);
    mockAccessSync.mockReturnValue(undefined);

    const result = await detectChromeBinary(undefined, 'darwin');
    expect(result).toBe(chromiumPath);
  });

  it('throws when no Chrome is found on macOS', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(detectChromeBinary(undefined, 'darwin')).rejects.toThrow(
      'Could not find Chrome. Install Chrome or set extension.chromeBinary in ~/.portalflow/config.json',
    );
  });
});

// ---------------------------------------------------------------------------
// detectChromeBinary — Windows detection
// ---------------------------------------------------------------------------

describe('detectChromeBinary — Windows (win32) detection', () => {
  beforeEach(resetMocks);

  it('finds Chrome in Program Files on Windows', async () => {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

    // On windows platform, existsSync is used (not which)
    mockExistsSync.mockImplementation((p) => p === chromePath);
    mockAccessSync.mockReturnValue(undefined);

    // Set environment variables for the test
    const originalPF = process.env['ProgramFiles'];
    process.env['ProgramFiles'] = 'C:\\Program Files';

    try {
      const result = await detectChromeBinary(undefined, 'win32');
      expect(result).toBe(chromePath);
    } finally {
      if (originalPF === undefined) {
        delete process.env['ProgramFiles'];
      } else {
        process.env['ProgramFiles'] = originalPF;
      }
    }
  });

  it('throws when no Chrome is found on Windows', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(detectChromeBinary(undefined, 'win32')).rejects.toThrow(
      'Could not find Chrome. Install Chrome or set extension.chromeBinary in ~/.portalflow/config.json',
    );
  });
});

// ---------------------------------------------------------------------------
// detectChromeBinary — error message format
// ---------------------------------------------------------------------------

describe('detectChromeBinary — error message', () => {
  beforeEach(resetMocks);

  it('mentions the config key in the "not found" error', async () => {
    mockExecSync.mockReturnValue('');

    await expect(detectChromeBinary(undefined, 'linux')).rejects.toThrow(
      'extension.chromeBinary in ~/.portalflow/config.json',
    );
  });
});

// ---------------------------------------------------------------------------
// launchChrome
// ---------------------------------------------------------------------------

describe('launchChrome', () => {
  beforeEach(resetMocks);

  it('passes --user-data-dir when profileMode is dedicated', () => {
    const proc = launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'dedicated',
      profileDir: '/home/user/.portalflow/chrome-profile',
    });

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [, args] = mockSpawn.mock.calls[0]!;
    expect(args).toContain('--no-first-run');
    expect(args).toContain('--no-default-browser-check');
    expect(args).toContain('--user-data-dir=/home/user/.portalflow/chrome-profile');
    expect(proc).toBeDefined();
  });

  it('does NOT pass --user-data-dir when profileMode is real', () => {
    launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'real',
    });

    const [, args] = mockSpawn.mock.calls[0]!;
    const hasUserDataDir = (args as string[]).some((a) => a.startsWith('--user-data-dir'));
    expect(hasUserDataDir).toBe(false);
  });

  it('does NOT pass --headless or --disable-extensions', () => {
    launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'real',
    });

    const [, args] = mockSpawn.mock.calls[0]!;
    const argStr = (args as string[]).join(' ');
    expect(argStr).not.toContain('--headless');
    expect(argStr).not.toContain('--disable-extensions');
  });

  it('launches with detached: true', () => {
    launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'real',
    });

    const [, , opts] = mockSpawn.mock.calls[0]!;
    expect((opts as { detached: boolean }).detached).toBe(true);
  });

  it('calls unref() on the child process', () => {
    const mockChild = { pid: 999, unref: vi.fn() };
    mockSpawn.mockReturnValueOnce(mockChild as unknown as ReturnType<typeof spawn>);

    launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'real',
    });

    expect(mockChild.unref).toHaveBeenCalledOnce();
  });

  it('throws when profileMode is dedicated but profileDir is missing', () => {
    expect(() =>
      launchChrome({
        binary: '/usr/bin/google-chrome',
        profileMode: 'dedicated',
        // profileDir not provided
      }),
    ).toThrow('profileDir is required when profileMode is "dedicated"');
  });

  it('passes --user-data-dir AND --profile-directory when real mode has a realProfile', () => {
    launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'real',
      realProfile: {
        userDataDir: '/home/user/.config/google-chrome',
        profileName: 'Profile 1',
        displayName: 'Work',
        browser: 'Google Chrome',
      },
    });

    const [, args] = mockSpawn.mock.calls[0]!;
    expect(args).toContain('--user-data-dir=/home/user/.config/google-chrome');
    expect(args).toContain('--profile-directory=Profile 1');
  });

  it('does NOT pass --user-data-dir or --profile-directory when real mode has no realProfile', () => {
    launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'real',
      // realProfile not provided
    });

    const [, args] = mockSpawn.mock.calls[0]!;
    const argStr = (args as string[]).join(' ');
    expect(argStr).not.toContain('--user-data-dir');
    expect(argStr).not.toContain('--profile-directory');
  });

  it('passes --user-data-dir only (no --profile-directory) for dedicated mode', () => {
    launchChrome({
      binary: '/usr/bin/google-chrome',
      profileMode: 'dedicated',
      profileDir: '/home/user/.portalflow/chrome-profile',
    });

    const [, args] = mockSpawn.mock.calls[0]!;
    expect(args).toContain('--user-data-dir=/home/user/.portalflow/chrome-profile');
    const argStr = (args as string[]).join(' ');
    expect(argStr).not.toContain('--profile-directory');
  });
});

// ---------------------------------------------------------------------------
// waitForExtensionHandshake
// ---------------------------------------------------------------------------

describe('waitForExtensionHandshake', () => {
  it('resolves immediately when the host is already connected', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => true;

    // Should resolve without hanging
    await expect(waitForExtensionHandshake(host as any, 5000)).resolves.toBeUndefined();
  });

  it('resolves when the host emits "connected" before the timeout', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const promise = waitForExtensionHandshake(host as any, 5000);
    // Emit connected after a short delay
    setImmediate(() => host.emit('connected'));

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with the detailed checklist when the timeout fires', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const promise = waitForExtensionHandshake(host as any, 50); // very short timeout

    await expect(promise).rejects.toThrow('Extension did not connect within 30 seconds.');
  });

  it('rejection message includes the chrome://extensions checklist', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const promise = waitForExtensionHandshake(host as any, 50);

    await expect(promise).rejects.toThrow('chrome://extensions');
  });

  it('rejection message includes the Load unpacked step', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const promise = waitForExtensionHandshake(host as any, 50);

    await expect(promise).rejects.toThrow('Load unpacked');
  });

  it('rejection message mentions port 7667', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const promise = waitForExtensionHandshake(host as any, 50);

    await expect(promise).rejects.toThrow('port 7667');
  });

  it('rejection message includes the npm build instruction', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const promise = waitForExtensionHandshake(host as any, 50);

    await expect(promise).rejects.toThrow('npm -w tools/extension run build');
  });

  it('rejection message includes real-profile extra check when realProfile is provided', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const realProfile = {
      userDataDir: '/home/user/.config/google-chrome',
      profileName: 'Profile 1',
      displayName: 'Work',
      browser: 'Google Chrome',
    };

    const promise = waitForExtensionHandshake(host as any, 50, realProfile);

    await expect(promise).rejects.toThrow('Extra check for real-profile mode');
  });

  it('rejection message names the displayName and profileName in real-profile extra check', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const realProfile = {
      userDataDir: '/home/user/.config/google-chrome',
      profileName: 'Profile 1',
      displayName: 'Work',
      browser: 'Google Chrome',
    };

    const promise = waitForExtensionHandshake(host as any, 50, realProfile);

    await expect(promise).rejects.toThrow('"Work"');
  });

  it('rejection message does NOT include real-profile extra check when realProfile is absent', async () => {
    const host = new EventEmitter() as EventEmitter & { isConnected: () => boolean };
    host.isConnected = () => false;

    const promise = waitForExtensionHandshake(host as any, 50);

    let errorMessage = '';
    try {
      await promise;
    } catch (err) {
      errorMessage = (err as Error).message;
    }
    expect(errorMessage).not.toContain('Extra check for real-profile mode');
    expect(errorMessage).toContain('Extension did not connect within 30 seconds.');
  });
});
