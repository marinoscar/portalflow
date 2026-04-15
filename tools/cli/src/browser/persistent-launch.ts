import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type pino from 'pino';

/**
 * Helpers for launching Chrome in persistent-profile mode against a real
 * user's `~/.config/google-chrome/` (or similar) user data directory.
 *
 * Persistent mode is the trickiest Playwright launch path: unlike isolated
 * mode (which uses a fresh temporary directory every time), persistent mode
 * attaches to a live on-disk profile that may have been previously opened
 * by the user's daily browser, possibly crashed, possibly left stale lock
 * files behind. The naive approach of calling `launchPersistentContext`
 * directly can hang indefinitely because:
 *
 *   1. Chrome's process singleton machinery forwards incoming launches to
 *      an existing Chrome process if `<userDataDir>/SingletonLock` points
 *      at a live pid. When that lock is stale (dead pid, but file still
 *      present), Chrome's forwarding hangs waiting for a reply that never
 *      arrives — and Playwright's CDP handshake waits on the spawned
 *      binary that has already exited.
 *   2. First-run dialogs, default-browser prompts, session-crash bubbles,
 *      and extension update notifications all block the initial page the
 *      automation expects to act on.
 *   3. Playwright's default `launchPersistentContext` has no reliable
 *      upper bound, so when anything goes wrong the caller just hangs
 *      without a clear error.
 *
 * This module addresses all three: a preflight check that verifies the
 * directory is actually usable and scrubs stale locks; a curated set of
 * launch flags that suppress the UI popups; and an explicit launch
 * timeout so worst-case behavior is a clear error instead of a hang.
 */

/**
 * Safe launch args for persistent-profile mode. These are cosmetic / UX
 * flags — they do not affect automation semantics, but they prevent
 * Playwright's very first action from fighting a popup that a returning
 * human-user Chrome would normally show.
 *
 *   --no-first-run                       — skip the first-run welcome
 *   --no-default-browser-check           — skip the "make Chrome default" prompt
 *   --disable-session-crashed-bubble     — suppress "Chrome didn't shut down
 *                                          correctly. Restore?" bubble when
 *                                          the profile's last exit wasn't clean
 *   --hide-crash-restore-bubble          — belt-and-suspenders for older builds
 *   --disable-infobars                   — suppress Chrome's own infobar
 *                                          warnings about command-line flags
 *   --password-store=basic               — prevent Chrome from trying to unlock
 *                                          the OS keyring (gnome-keyring, kwallet),
 *                                          which sometimes prompts for a password
 *                                          during headless / automation launches
 */
export const PERSISTENT_LAUNCH_ARGS: readonly string[] = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  '--disable-infobars',
  '--password-store=basic',

  // --- Network-suppression flags ---
  // Stop Chrome from making startup network calls (sync, component
  // updates, metrics, default-apps check, field-trial config) which
  // can block Playwright's CDP handshake. Without these, a real
  // user profile with sync enabled may sit on a network call for
  // tens of seconds before answering CDP.
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-sync',
  '--metrics-recording-only',
  '--disable-client-side-phishing-detection',
  '--disable-renderer-backgrounding',
  '--disable-features=TranslateUI,OptimizationHints,MediaRouter,DialMediaRouteProvider',
];

/**
 * Explicit timeout for `launchPersistentContext`. Chrome startup on a real
 * profile with many extensions and a lot of history can take 15–30 seconds
 * on slower hardware, so the timeout needs headroom — but not infinite,
 * because a genuinely hung launch should fail cleanly within a minute so
 * the user sees an actionable error instead of an empty terminal.
 */
export const PERSISTENT_LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Result of reading the `SingletonLock` file inside a user data directory.
 *
 * On Linux (the platform we target), Chrome writes `SingletonLock` as a
 * symbolic link whose target is `<hostname>-<pid>`. Reading the symlink
 * tells us which pid "owns" the profile, and a `kill(pid, 0)` test tells
 * us whether that pid is still alive.
 *
 *   - `null`                       → the lock file does not exist; nothing holds the directory.
 *   - `{ pid, stale: false }`      → the lock points to a live Chrome process (do NOT touch).
 *   - `{ pid: -1, stale: true }`   → the lock is present but malformed; safe to remove.
 *   - `{ pid, stale: true }`       → the lock points to a dead pid; safe to remove.
 */
export interface LockInspection {
  pid: number;
  stale: boolean;
}

export function inspectSingletonLock(userDataDir: string): LockInspection | null {
  const lockPath = join(userDataDir, 'SingletonLock');
  let stat;
  try {
    stat = lstatSync(lockPath);
  } catch {
    return null;
  }
  if (!stat.isSymbolicLink()) {
    // Windows (the lock is a regular file there) and corrupted Linux
    // states both land here. Treat as stale-and-removable.
    return { pid: -1, stale: true };
  }
  let target: string;
  try {
    target = readlinkSync(lockPath);
  } catch {
    return { pid: -1, stale: true };
  }

  // Format: "<hostname>-<pid>". The hostname is whatever Chrome saw at
  // launch time, which can include hyphens, so use the LAST hyphen as
  // the pid delimiter.
  const dashIdx = target.lastIndexOf('-');
  if (dashIdx === -1 || dashIdx === target.length - 1) {
    return { pid: -1, stale: true };
  }
  const pidStr = target.slice(dashIdx + 1);
  const pid = parseInt(pidStr, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { pid: -1, stale: true };
  }

  try {
    // Signal 0 is a no-op that only checks whether the caller has
    // permission to send a signal to the target; ESRCH means the pid
    // doesn't exist. Any other error (EPERM) means it does exist and
    // we just can't signal it — still counts as live.
    process.kill(pid, 0);
    return { pid, stale: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { pid, stale: true };
    // EPERM: process exists but we can't signal it — treat as live.
    return { pid, stale: false };
  }
}

/**
 * Patch a Chrome profile's `Preferences` file so Chrome believes the
 * previous session exited cleanly. Without this, a profile whose last
 * Chrome process was killed (by `pkill -f chrome`, a crash, or
 * Playwright's close() during a stuck launch) has
 * `profile.exit_type === "Crashed"` / `profile.exited_cleanly === false`
 * in its Preferences file. On next launch, Chrome fires the session-
 * restore machinery: it may show a "Chrome didn't shut down correctly.
 * Restore?" bubble (suppressed by --disable-session-crashed-bubble /
 * --hide-crash-restore-bubble on newer builds but not always), and
 * more importantly it MAY block Playwright's initial CDP handshake
 * while session restore is in flight.
 *
 * This is the same trick undetected-chromedriver uses to keep real
 * Chrome profiles automatable across runs.
 *
 * Writes atomically via a temporary file + rename so a crashed write
 * cannot corrupt the user's real profile.
 *
 * Returns `true` if Preferences was patched, `false` if the file was
 * missing, already clean, or could not be read (in which case the
 * caller should log a warning but NOT abort — the flags above are
 * enough to get past most session-restore behavior even without the
 * Preferences patch).
 */
export function patchProfilePreferences(
  userDataDir: string,
  profileDirectory: string | undefined,
  logger?: pino.Logger,
): boolean {
  const profileDir = profileDirectory
    ? join(userDataDir, profileDirectory)
    : join(userDataDir, 'Default');
  const prefsPath = join(profileDir, 'Preferences');

  if (!existsSync(prefsPath)) {
    // Fresh profile with no Preferences yet — nothing to patch.
    return false;
  }

  let raw: string;
  try {
    raw = readFileSync(prefsPath, 'utf-8');
  } catch (err) {
    logger?.warn(
      { prefsPath, err },
      'Could not read Chrome Preferences for session-exit patch (non-fatal — continuing launch)',
    );
    return false;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    logger?.warn(
      { prefsPath, err },
      'Chrome Preferences is not valid JSON (may be corrupted from a crashed write) — skipping session-exit patch',
    );
    return false;
  }

  const profile = (parsed.profile ??= {}) as Record<string, unknown>;
  const wasCrashed =
    profile.exit_type !== 'Normal' || profile.exited_cleanly !== true;
  if (!wasCrashed) {
    // Already clean. Nothing to do.
    return false;
  }

  profile.exit_type = 'Normal';
  profile.exited_cleanly = true;

  // Write atomically: serialize to a temp file, then rename over the
  // original. rename(2) is atomic within a filesystem, so even if the
  // process is killed mid-write Chrome's profile stays in a consistent
  // state — either the old file or the new one.
  const tmpPath = `${prefsPath}.portalflow.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(parsed), 'utf-8');
    renameSync(tmpPath, prefsPath);
  } catch (err) {
    logger?.warn(
      { prefsPath, err },
      'Failed to write patched Chrome Preferences — continuing launch with in-file state',
    );
    // Best-effort tmp cleanup if the rename failed but the write
    // succeeded. Ignore any error from this.
    try {
      unlinkSync(tmpPath);
    } catch {
      /* swallow */
    }
    return false;
  }

  logger?.info(
    {
      prefsPath,
      profileDirectory: profileDirectory ?? 'Default',
      previousExitType: 'Crashed',
    },
    'Patched Chrome Preferences to mark previous session as cleanly exited',
  );
  return true;
}

/**
 * Remove stale Chrome singleton files from a user data directory.
 * The caller MUST verify beforehand that no live Chrome process holds
 * the directory (via `inspectSingletonLock`); this function does not
 * re-check and will gladly clobber a live lock otherwise.
 *
 * Returns the names of the files it removed, for logging.
 */
export function clearSingletonFiles(
  userDataDir: string,
  logger?: pino.Logger,
): string[] {
  const removed: string[] = [];
  const names = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const name of names) {
    const path = join(userDataDir, name);
    try {
      unlinkSync(path);
      removed.push(name);
    } catch {
      // Either the file doesn't exist or we can't remove it; either
      // way it's not worth surfacing. If it still blocks the launch,
      // the downstream Playwright error will tell us.
    }
  }
  if (removed.length > 0) {
    logger?.info(
      { userDataDir, removed },
      'Cleared stale Chrome singleton files from user data directory',
    );
  }
  return removed;
}

export interface PreflightOptions {
  userDataDir: string;
  profileDirectory?: string;
  logger?: pino.Logger;
}

/**
 * Preflight check before `launchPersistentContext`. Validates that the
 * directory layout is sane, refuses to run when a live Chrome is holding
 * the profile, and cleans up stale singleton files otherwise so the
 * following launch doesn't hang on forwarded commands to a dead pid.
 *
 * Throws with a user-actionable error message on any failure.
 */
export function preflightPersistentLaunch(options: PreflightOptions): void {
  const { userDataDir, profileDirectory, logger } = options;

  if (!existsSync(userDataDir)) {
    throw new Error(
      `Persistent browser user data directory does not exist: "${userDataDir}". ` +
        `Check browser.userDataDir in your config, or run \`portalflow settings browser\` to pick a different profile.`,
    );
  }

  if (profileDirectory) {
    const subProfile = join(userDataDir, profileDirectory);
    if (!existsSync(subProfile)) {
      throw new Error(
        `Browser profile sub-directory does not exist: "${subProfile}". ` +
          `The user data directory is present, but the profile "${profileDirectory}" is not. ` +
          `Run \`portalflow settings browser\` to pick a different profile.`,
      );
    }
  }

  const lock = inspectSingletonLock(userDataDir);
  if (lock && !lock.stale) {
    throw new Error(
      `Cannot launch a persistent browser against "${userDataDir}"${
        profileDirectory ? ` (profile "${profileDirectory}")` : ''
      } — it is currently in use by Chrome process ${lock.pid}. ` +
        `Close all Chrome windows that use this profile and try again. ` +
        `If no Chrome window is visible, the process may be running in the background (try \`pkill -f chrome\`).`,
    );
  }

  // At this point we've verified no live Chrome holds the lock. Clean
  // up any stale singleton files left behind by a crashed / killed
  // prior launch so Chrome's process-singleton machinery doesn't try
  // to forward the new launch to a dead pid.
  clearSingletonFiles(userDataDir, logger);

  // Patch the profile's Preferences file so Chrome doesn't try to
  // restore the previous session on startup — which is the single
  // most common reason a persistent-mode launch hangs after the
  // singleton files have been cleaned.
  patchProfilePreferences(userDataDir, profileDirectory, logger);
}
