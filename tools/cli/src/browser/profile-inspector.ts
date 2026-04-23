import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * A discovered Chromium-family browser profile on the local machine.
 *
 * `userDataDir` is the path you pass as `--user-data-dir` to Chrome.
 * `profileDirectory` is the sub-folder inside the user data dir
 * (e.g. "Default", "Profile 1") that selects which actual profile is used —
 * passed to Chromium via the `--profile-directory=` command-line flag.
 *
 * `displayName` and `email` are derived from the browser's own metadata
 * (the `Local State` JSON file) so the TUI can show "Personal — oscar@…"
 * instead of just "Profile 3".
 *
 * Note: the `channel` field present in tools/cli's BrowserProfile has been
 * intentionally omitted here. cli2 does not use Playwright channels — it
 * spawns Chrome directly as a plain binary.
 */
export interface BrowserProfile {
  /** Friendly browser name: "Google Chrome", "Brave", "Chromium", "Microsoft Edge". */
  browser: string;
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
 * on Linux. Each entry is a (browser-friendly-name, candidate paths) pair.
 * Only directories that actually exist on disk are surfaced to the user —
 * this list is the catalog, not the answer.
 *
 * TODO: macOS and Windows support would mirror the tools/cli patterns
 * (~/Library/Application Support/Google/Chrome on macOS,
 * %LOCALAPPDATA%\Google\Chrome\User Data on Windows). Adding platform
 * branches here is the only change needed.
 *
 * cli2 is Ubuntu-first per VISION.md so we cover Linux only for now.
 */
interface BrowserInstall {
  browser: string;
  candidatePaths: string[];
}

function linuxInstalls(): BrowserInstall[] {
  const home = homedir();
  return [
    {
      browser: 'Google Chrome',
      candidatePaths: [join(home, '.config', 'google-chrome')],
    },
    {
      browser: 'Google Chrome Beta',
      candidatePaths: [join(home, '.config', 'google-chrome-beta')],
    },
    {
      browser: 'Google Chrome Dev',
      candidatePaths: [join(home, '.config', 'google-chrome-unstable')],
    },
    {
      browser: 'Chromium',
      candidatePaths: [
        join(home, '.config', 'chromium'),
        join(home, 'snap', 'chromium', 'common', 'chromium'),
      ],
    },
    {
      browser: 'Brave',
      candidatePaths: [join(home, '.config', 'BraveSoftware', 'Brave-Browser')],
    },
    {
      browser: 'Microsoft Edge',
      candidatePaths: [join(home, '.config', 'microsoft-edge')],
    },
    {
      browser: 'Microsoft Edge Beta',
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

// Re-export the parser and helpers for unit tests so we can feed them
// synthetic JSON and inputs without touching the filesystem.
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
