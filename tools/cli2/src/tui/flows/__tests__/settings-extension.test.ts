/**
 * settings-extension.test.ts
 *
 * Covers the undefined-prompt-value bug fixed in settings-extension.ts.
 * Uses vitest's module mocking to return `undefined` from specific p.text()
 * calls without spinning up a real TTY.
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
  mockLogSuccess,
  mockLoad,
  mockSetExtension,
} = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockSelect: vi.fn(),
  mockConfirm: vi.fn(),
  mockIsCancel: vi.fn((_v?: unknown) => false),
  mockNote: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogSuccess: vi.fn(),
  mockLoad: vi.fn(),
  mockSetExtension: vi.fn(),
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
    warn: vi.fn(),
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
// Import SUT after mocks are registered
// ---------------------------------------------------------------------------
import { runExtensionSettings } from '../settings-extension.js';
import type { ConfigService } from '../../../config/config.service.js';
import { defaultExtensionConfig } from '../../../config/config.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfigService(): ConfigService {
  return {
    load: mockLoad,
    setExtension: mockSetExtension,
  } as unknown as ConfigService;
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
  });

  it('does not throw when chromeBinary prompt returns undefined (user cleared the field)', async () => {
    // Simulate: host='127.0.0.1', port='7667', profileMode=dedicated,
    // profileDir='/some/dir', closeWindowOnFinish=false, chromeBinary=undefined.
    // The last case is the reported crash: p.text() returns undefined for an
    // empty field and the old code did `(binaryInput as string).trim()`.
    mockText
      .mockResolvedValueOnce('127.0.0.1')  // host
      .mockResolvedValueOnce('7667')        // port
      .mockResolvedValueOnce('/some/dir')   // profileDir (dedicated branch)
      .mockResolvedValueOnce(undefined);    // chromeBinary — the crashing case

    mockSelect.mockResolvedValueOnce('dedicated');
    mockConfirm.mockResolvedValueOnce(false);

    // Must not throw
    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    expect(mockSetExtension).toHaveBeenCalledOnce();
    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    // chromeBinary should be omitted (undefined) — not crash, not empty string
    expect(savedUpdate.chromeBinary).toBeUndefined();
  });

  it('falls back to current.port when port prompt returns undefined', async () => {
    const currentPort = 7667; // defaultExtensionConfig().port

    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce(undefined)    // port cleared → must fall back, not NaN
      .mockResolvedValueOnce('/some/dir')
      .mockResolvedValueOnce('');          // chromeBinary empty string

    mockSelect.mockResolvedValueOnce('dedicated');
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

    mockSelect.mockResolvedValueOnce('dedicated');
    mockConfirm.mockResolvedValueOnce(true);

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.chromeBinary).toBe('/usr/bin/google-chrome');
  });

  it('does not set profileDir when profileMode is real', async () => {
    // real mode: the profileDir p.text() prompt is skipped entirely
    mockText
      .mockResolvedValueOnce('127.0.0.1')
      .mockResolvedValueOnce('7667')
      .mockResolvedValueOnce(undefined); // chromeBinary

    mockSelect.mockResolvedValueOnce('real');
    mockConfirm.mockResolvedValueOnce(false);

    await expect(runExtensionSettings(makeConfigService())).resolves.toBeUndefined();

    const savedUpdate = mockSetExtension.mock.calls[0][0] as Record<string, unknown>;
    expect(savedUpdate.profileDir).toBeUndefined();
    expect(savedUpdate.profileMode).toBe('real');
  });
});
