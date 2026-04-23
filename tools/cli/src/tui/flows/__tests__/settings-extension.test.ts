/**
 * settings-extension.test.ts
 *
 * Covers the extension settings flow including:
 *   - The undefined-prompt-value bug fixed previously.
 *   - The new real-profile selector integration.
 *
 * Uses vitest's module mocking to stub p.text/select/confirm and
 * discoverBrowserProfiles without spinning up a real TTY or touching disk.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock stubs so they are available inside vi.mock() factories.
// vi.mock() calls are hoisted to the top of the file by vitest; any variables
// they reference must be declared with vi.hoisted() or the factory will see
// them in the temporal dead zone (ReferenceError).
// ---------------------------------------------------------------------------
const {
  mockText,
  mockSelect,
  mockConfirm,
  mockIsCancel,
  mockNote,
  mockLogInfo,
  mockLogWarn,
  mockLogSuccess,
  mockLoad,
  mockSetExtension,
  mockDiscoverBrowserProfiles,
} = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockSelect: vi.fn(),
  mockConfirm: vi.fn(),
  mockIsCancel: vi.fn((_v?: unknown) => false),
  mockNote: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogSuccess: vi.fn(),
  mockLoad: vi.fn(),
  mockSetExtension: vi.fn(),
  mockDiscoverBrowserProfiles: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock node:fs — mkdirSync is called when profileMode === 'dedicated'
// ---------------------------------------------------------------------------
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @clack/prompts
// ---------------------------------------------------------------------------
vi.mock('@clack/prompts', () => ({
  text: (...args: unknown[]) => mockText(...args),
  select: (...args: unknown[]) => mockSelect(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  isCancel: (v?: unknown) => mockIsCancel(v),
  note: (...args: unknown[]) => mockNote(...args),
  log: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    success: (...args: unknown[]) => mockLogSuccess(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock ConfigService — keep real defaultExtensionConfig, stub load/setExtension
// ---------------------------------------------------------------------------
vi.mock('../../../config/config.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/config.service.js')>();
  return {
    ...actual,
    ConfigService: vi.fn().mockImplementation(() => ({
      load: mockLoad,
      setExtension: mockSetExtension,
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock profile-inspector — discoverBrowserProfiles so tests don't hit disk
// ---------------------------------------------------------------------------
vi.mock('../../../browser/profile-inspector.js', () => ({
  discoverBrowserProfiles: (...args: unknown[]) => mockDiscoverBrowserProfiles(...args),
  formatProfileLine: (p: { browser: string; displayName: string; email?: string; profileDirectory: string }) =>
    `${p.browser} / ${p.displayName}  [${p.profileDirectory}]`,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are registered
// ---------------------------------------------------------------------------
import { runExtensionSettings } from '../settings-extension.js';
import type { ConfigService } from '../../../config/config.service.js';
import { defaultExtensionConfig } from '../../../config/config.service.js';
import type { BrowserProfile } from '../../../browser/profile-inspector.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PROFILE_WORK: BrowserProfile = {
  browser: 'Google Chrome',
  userDataDir: '/home/user/.config/google-chrome',
  profileDirectory: 'Profile 1',
  displayName: 'Work',
  email: 'oscar@work.com',
};

const PROFILE_PERSONAL: BrowserProfile = {
  browser: 'Google Chrome',
  userDataDir: '/home/user/.config/google-chrome',
  profileDirectory: 'Default',
  displayName: 'Personal',
  email: 'oscar@marin.cr',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfigService(): ConfigService {
  return {
    load: mockLoad,
    setExtension: mockSetExtension,
  } as unknown as ConfigService;
}

/**
 * Set up mockSelect to reply with profileMode and, for real mode, immediately
 * reply to the profile-selector select as well.
 *
 * For dedicated mode: one select call (profileMode).
 * For real mode: two select calls (profileMode, then profile selector).
 */
function setupSelectSequence(
  profileMode: 'dedicated' | 'real',
  realProfileValue?: BrowserProfile | null,
): void {
  if (profileMode === 'dedicated') {
    mockSelect.mockResolvedValueOnce('dedicated');
  } else {
    mockSelect
      .mockResolvedValueOnce('real')           // profileMode select
      .mockResolvedValueOnce(realProfileValue ?? null); // profile selector
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('runExtensionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCancel.mockReturnValue(false);

    // Default: load returns a config with default extension settings
    mockLoad.mockResolvedValue({
      extension: defaultExtensionConfig(),
    });

    mockSetExtension.mockResolvedValue(undefined);

    // Default: two profiles available
    mockDiscoverBrowserProfiles.mockReturnValue([PROFILE_WORK, PROFILE_PERSONAL]);
  });

  // ---------------------------------------------------------------------------
  // Existing regression tests
  // ---------------------------------------------------------------------------

  it('does not throw when chromeBinary prompt returns undefined (user cleared the field)', async () => {
    mockText
      .mockResolvedValueOnce('127.0.0.1')  // host
      .mockResolvedValueOnce('7667')        // port
      .mockResolvedValueOnce('/some/dir')   // profileDir (dedicated branch)
      .mockResolvedValueOnce(undefined);    // chromeBinary — the crashing case

    setupSelectSequence('dedicated');
    mockConfirm.mockResolvedValueOnce(false);

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    expect(mockSetExtension).toHaveBeenCalledOnce();
    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.chromeBinary).toBeUndefined();
  });

  it('falls back to current.port when port prompt returns undefined', async () => {
    const currentPort = 7667; // defaultExtensionConfig().port

    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce(undefined)    // port cleared → must fall back, not NaN
      .mockResolvedValueOnce('/some/dir')
      .mockResolvedValueOnce('');          // chromeBinary empty string

    setupSelectSequence('dedicated');
    mockConfirm.mockResolvedValueOnce(false);

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    expect(mockSetExtension).toHaveBeenCalledOnce();
    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.port).toBe(currentPort);
    expect(Number.isNaN(savedUpdate.port)).toBe(false);
  });

  it('saves the provided chromeBinary path when the user enters a non-empty value', async () => {
    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce('/home/user/.portalflow/chrome-profile')
      .mockResolvedValueOnce('/usr/bin/google-chrome');

    setupSelectSequence('dedicated');
    mockConfirm.mockResolvedValueOnce(true);

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.chromeBinary).toBe('/usr/bin/google-chrome');
  });

  it('does not set profileDir when profileMode is real', async () => {
    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce(undefined); // chromeBinary

    setupSelectSequence('real', PROFILE_WORK);
    mockConfirm.mockResolvedValueOnce(false); // closeWindowOnFinish

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.profileDir).toBeUndefined();
    expect(savedUpdate.profileMode).toBe('real');
  });

  // ---------------------------------------------------------------------------
  // New: real-profile selector integration
  // ---------------------------------------------------------------------------

  it('saves the chosen realProfile when user picks a specific profile', async () => {
    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce(undefined); // chromeBinary

    setupSelectSequence('real', PROFILE_WORK);
    mockConfirm.mockResolvedValueOnce(false); // closeWindowOnFinish

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.realProfile).toEqual({
      userDataDir: PROFILE_WORK.userDataDir,
      profileName: PROFILE_WORK.profileDirectory,
      displayName: PROFILE_WORK.displayName,
      browser: PROFILE_WORK.browser,
    });
  });

  it('saves realProfile: undefined when user picks "Let Chrome decide"', async () => {
    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce(undefined); // chromeBinary

    setupSelectSequence('real', null); // null = "Let Chrome decide"
    mockConfirm.mockResolvedValueOnce(false);

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.realProfile).toBeUndefined();
    expect(savedUpdate.profileMode).toBe('real');
  });

  it('skips the profile selector and saves realProfile: undefined when discoverBrowserProfiles returns empty', async () => {
    mockDiscoverBrowserProfiles.mockReturnValue([]);

    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce(undefined); // chromeBinary

    // Only one select call: profileMode (no profile selector opens)
    mockSelect.mockResolvedValueOnce('real');
    mockConfirm.mockResolvedValueOnce(false);

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.realProfile).toBeUndefined();
    expect(savedUpdate.profileMode).toBe('real');

    // The warn about no profiles was shown
    expect(mockLogWarn).toHaveBeenCalledOnce();
  });

  it('offers keep-or-re-select when already in real mode with an existing realProfile and user says keep', async () => {
    // Config already has real mode + a profile
    mockLoad.mockResolvedValue({
      extension: {
        ...defaultExtensionConfig(),
        profileMode: 'real' as const,
        realProfile: {
          userDataDir: PROFILE_PERSONAL.userDataDir,
          profileName: PROFILE_PERSONAL.profileDirectory,
          displayName: PROFILE_PERSONAL.displayName,
          browser: PROFILE_PERSONAL.browser,
        },
      },
    });

    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce(undefined); // chromeBinary

    // profileMode select stays 'real'; no profile-selector select needed
    mockSelect.mockResolvedValueOnce('real');
    // confirm: keep=true, then closeWindowOnFinish=false
    mockConfirm
      .mockResolvedValueOnce(true)   // keep the existing profile
      .mockResolvedValueOnce(false); // closeWindowOnFinish

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    // The original profile is kept
    expect(savedUpdate.realProfile).toEqual({
      userDataDir: PROFILE_PERSONAL.userDataDir,
      profileName: PROFILE_PERSONAL.profileDirectory,
      displayName: PROFILE_PERSONAL.displayName,
      browser: PROFILE_PERSONAL.browser,
    });
  });

  it('re-runs profile selector when already in real mode with an existing realProfile and user says no keep', async () => {
    mockLoad.mockResolvedValue({
      extension: {
        ...defaultExtensionConfig(),
        profileMode: 'real' as const,
        realProfile: {
          userDataDir: PROFILE_PERSONAL.userDataDir,
          profileName: PROFILE_PERSONAL.profileDirectory,
          displayName: PROFILE_PERSONAL.displayName,
          browser: PROFILE_PERSONAL.browser,
        },
      },
    });

    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce(undefined); // chromeBinary

    mockSelect
      .mockResolvedValueOnce('real')       // profileMode stays real
      .mockResolvedValueOnce(PROFILE_WORK); // re-select → pick Work
    mockConfirm
      .mockResolvedValueOnce(false)  // keep=false → re-open selector
      .mockResolvedValueOnce(false); // closeWindowOnFinish

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.realProfile).toEqual({
      userDataDir: PROFILE_WORK.userDataDir,
      profileName: PROFILE_WORK.profileDirectory,
      displayName: PROFILE_WORK.displayName,
      browser: PROFILE_WORK.browser,
    });
  });
});
