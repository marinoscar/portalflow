import { existsSync, lstatSync, readlinkSync, unlinkSync } from 'node:fs';
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
}
