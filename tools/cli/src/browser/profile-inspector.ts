import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserChannel } from '../config/config.service.js';

/**
 * A discovered Chromium-family browser profile on the local machine.
 *
 * `userDataDir` is the path you pass to Playwright's
 * `chromium.launchPersistentContext()`. `profileDirectory` is the sub-folder
 * inside the user data dir (e.g. "Default", "Profile 1") that selects which
 * actual profile is used — passed to Chromium via the `--profile-directory=`
 * command-line flag.
 *
 * `displayName` and `email` are derived from the browser's own metadata
 * (the `Local State` JSON file) so the TUI can show "Personal — oscar@…"
 * instead of just "Profile 3".
 */
export interface BrowserProfile {
  /** Friendly browser name: "Google Chrome", "Brave", "Chromium", "Microsoft Edge". */
  browser: string;
  /** Playwright channel value to pass to chromium.launch / launchPersistentContext. */
  channel: BrowserChannel;
  /** Absolute path to the user data directory. */
  userDataDir: string;
  /** Sub-profile name inside the user data dir, e.g. "Default" or "Profile 1". */
  profileDirectory: string;
  /** Human-readable name from the browser's profile metadata. */
  displayName: string;
  /** Signed-in email if present in the profile's metadata, otherwise undefined. */
  email?: string;
}

/**
 * Static list of Chromium-family installations the inspector knows about
 * on Linux. Each entry is a (channel, browser-friendly-name, candidate paths)
 * triple. Only directories that actually exist on disk are surfaced to the
 * user — this list is the catalog, not the answer.
 *
 * macOS and Windows would have different paths; this CLI is Ubuntu-first
 * per VISION.md so we cover Linux first and add other platforms as needed.
 */
interface BrowserInstall {
  browser: string;
  channel: BrowserChannel;
  candidatePaths: string[];
}

function linuxInstalls(): BrowserInstall[] {
  const home = homedir();
  return [
    {
      browser: 'Google Chrome',
      channel: 'chrome',
      candidatePaths: [join(home, '.config', 'google-chrome')],
    },
    {
      browser: 'Google Chrome Beta',
      channel: 'chrome-beta',
      candidatePaths: [join(home, '.config', 'google-chrome-beta')],
    },
    {
      browser: 'Google Chrome Dev',
      channel: 'chrome-dev',
      candidatePaths: [join(home, '.config', 'google-chrome-unstable')],
    },
    {
      browser: 'Chromium',
      channel: 'chromium',
      candidatePaths: [
        join(home, '.config', 'chromium'),
        join(home, 'snap', 'chromium', 'common', 'chromium'),
      ],
    },
    {
      browser: 'Brave',
      channel: 'chrome', // Brave is Chrome-compatible; Playwright launches it via the chrome channel
      candidatePaths: [join(home, '.config', 'BraveSoftware', 'Brave-Browser')],
    },
    {
      browser: 'Microsoft Edge',
      channel: 'msedge',
      candidatePaths: [join(home, '.config', 'microsoft-edge')],
    },
    {
      browser: 'Microsoft Edge Beta',
      channel: 'msedge-beta',
      candidatePaths: [join(home, '.config', 'microsoft-edge-beta')],
    },
  ];
}

/**
 * The minimal shape we read from `<userDataDir>/Local State`. Chrome stores
 * a profile cache under `profile.info_cache` keyed by the directory name
 * (e.g. "Default", "Profile 1") with display metadata.
 */
interface LocalStateProfileEntry {
  name?: string;
  user_name?: string;
  gaia_name?: string;
  gaia_given_name?: string;
}
interface LocalStateShape {
  profile?: {
    info_cache?: Record<string, LocalStateProfileEntry>;
  };
}

function readLocalState(userDataDir: string): LocalStateShape | null {
  const path = join(userDataDir, 'Local State');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as LocalStateShape;
  } catch {
    return null;
  }
}

function deriveDisplayName(
  dir: string,
  entry: LocalStateProfileEntry | undefined,
): string {
  if (entry?.name && entry.name.trim().length > 0) return entry.name.trim();
  if (entry?.gaia_name && entry.gaia_name.trim().length > 0) return entry.gaia_name.trim();
  if (dir === 'Default') return 'Default';
  return dir;
}

function deriveEmail(entry: LocalStateProfileEntry | undefined): string | undefined {
  const email = entry?.user_name;
  return email && email.includes('@') ? email : undefined;
}

/**
 * Walk a single Chrome installation and turn every present sub-profile into
 * a `BrowserProfile` row. Returns an empty array if the install isn't on
 * disk at all.
 */
function listProfilesForInstall(install: BrowserInstall): BrowserProfile[] {
  const userDataDir = install.candidatePaths.find((p) => existsSync(p));
  if (!userDataDir) return [];

  const localState = readLocalState(userDataDir);
  const cache = localState?.profile?.info_cache ?? {};
  const dirs = new Set<string>(Object.keys(cache));

  // Always include Default if its directory exists, even if Local State
  // doesn't list it (some installs are barely-used and have no metadata).
  if (existsSync(join(userDataDir, 'Default'))) dirs.add('Default');

  const profiles: BrowserProfile[] = [];
  for (const dir of dirs) {
    if (!existsSync(join(userDataDir, dir))) continue;
    const entry = cache[dir];
    profiles.push({
      browser: install.browser,
      channel: install.channel,
      userDataDir,
      profileDirectory: dir,
      displayName: deriveDisplayName(dir, entry),
      email: deriveEmail(entry),
    });
  }

  // Sort: Default first, then alphabetically by display name.
  profiles.sort((a, b) => {
    if (a.profileDirectory === 'Default' && b.profileDirectory !== 'Default') return -1;
    if (b.profileDirectory === 'Default' && a.profileDirectory !== 'Default') return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return profiles;
}

/**
 * Discover every Chromium-family browser profile installed on the local
 * machine. Returns a flat list ordered by browser, then by profile (Default
 * first within each install).
 *
 * This function is read-only and synchronous — it just reads `Local State`
 * JSON files. No browser is launched, no lock is acquired.
 */
export function discoverBrowserProfiles(): BrowserProfile[] {
  const installs = linuxInstalls();
  const all: BrowserProfile[] = [];
  for (const install of installs) {
    all.push(...listProfilesForInstall(install));
  }
  return all;
}

/**
 * Format a profile as a single human-friendly line for the TUI / `--list`
 * subcommand. Example:
 *   "Google Chrome / Personal — oscar@marin.cr  [Default]"
 */
export function formatProfileLine(p: BrowserProfile): string {
  const emailPart = p.email ? ` — ${p.email}` : '';
  return `${p.browser} / ${p.displayName}${emailPart}  [${p.profileDirectory}]`;
}

// Re-export the parser for unit tests so we can feed it synthetic JSON.
export const __test__ = {
  readLocalStateContent(content: string): LocalStateShape | null {
    try {
      return JSON.parse(content) as LocalStateShape;
    } catch {
      return null;
    }
  },
  deriveDisplayName,
  deriveEmail,
};
