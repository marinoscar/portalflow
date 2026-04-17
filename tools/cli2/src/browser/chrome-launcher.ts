/**
 * chrome-launcher.ts
 *
 * Detects the Chrome binary on the current platform, spawns Chrome with the
 * appropriate profile flags, and waits for the PortalFlow extension to connect
 * over the ExtensionHost WebSocket.
 *
 * Design notes:
 * - Chrome is spawned with `detached: true` and `.unref()` so it keeps running
 *   after the CLI exits. The user's Chrome is unaffected by CLI process lifecycle.
 * - No --headless, --disable-extensions, or stealth flags are passed. Chrome runs
 *   as a normal user-facing browser.
 * - The caller receives the ChildProcess handle but should NOT kill it on teardown
 *   unless they explicitly want to close Chrome.
 */

import { existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type pino from 'pino';
import type { ExtensionHost } from './extension-host.js';
import type { ExtensionConfig, RealProfileSelection } from '../config/config.service.js';

// ---------------------------------------------------------------------------
// killExistingChrome
// ---------------------------------------------------------------------------

/**
 * Kills all running Chrome/Chromium processes on the current platform.
 *
 * This is a best-effort operation — if no matching process is found (pkill
 * exits with code 1 on Linux/macOS) the error is swallowed silently. After
 * killing, a 1.5 s pause lets processes fully exit and release file locks
 * before Chrome is relaunched.
 *
 * Only supported on linux, darwin, and win32. Other platforms are skipped
 * with a warning.
 */
export async function killExistingChrome(logger: pino.Logger): Promise<void> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === 'linux') {
    cmd = 'pkill';
    args = ['-f', 'google-chrome|chromium-browser|chromium'];
  } else if (platform === 'darwin') {
    cmd = 'pkill';
    args = ['-f', 'Google Chrome|Chromium'];
  } else if (platform === 'win32') {
    cmd = 'taskkill';
    args = ['/IM', 'chrome.exe', '/F'];
  } else {
    logger.warn(`killExistingChrome: unsupported platform ${platform}`);
    return;
  }

  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync(cmd, args, { stdio: 'ignore' });
    logger.info('Killed existing Chrome instances');
    // Brief pause to let processes fully exit and release locks
    await new Promise(r => setTimeout(r, 1500));
  } catch {
    // pkill exits with code 1 when no matching process found — that's fine
    logger.debug('No existing Chrome processes found (or kill failed silently)');
  }
}

// ---------------------------------------------------------------------------
// Helpers for binary resolution
// ---------------------------------------------------------------------------

function isExecutable(p: string): boolean {
  try {
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function whichSync(bin: string): string | undefined {
  try {
    const result = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    return result.length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// detectChromeBinary
// ---------------------------------------------------------------------------

/**
 * Resolves the Chrome binary path.
 *
 * If `override` is provided, it must exist and be executable — otherwise an
 * error is thrown. If omitted, the function probes platform-specific locations
 * in a fixed priority order.
 *
 * @param override - Optional absolute path override from config.
 * @param platform - Defaults to `process.platform`. Injected for testability.
 */
export async function detectChromeBinary(
  override?: string,
  platform: string = process.platform,
): Promise<string> {
  if (override) {
    if (!existsSync(override) || !isExecutable(override)) {
      throw new Error(
        `Configured chromeBinary does not exist or is not executable: ${override}`,
      );
    }
    return override;
  }

  if (platform === 'linux') {
    for (const candidate of [
      'google-chrome-stable',
      'google-chrome',
      'chromium',
      'chromium-browser',
    ]) {
      const found = whichSync(candidate);
      if (found) return found;
    }
  } else if (platform === 'darwin') {
    for (const candidate of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      if (existsSync(candidate) && isExecutable(candidate)) {
        return candidate;
      }
    }
  } else if (platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LocalAppData'] ?? '';

    for (const candidate of [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      ...(local ? [`${local}\\Google\\Chrome\\Application\\chrome.exe`] : []),
    ]) {
      if (existsSync(candidate) && isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    'Could not find Chrome. Install Chrome or set extension.chromeBinary in ~/.portalflow/config.json',
  );
}

// ---------------------------------------------------------------------------
// launchChrome
// ---------------------------------------------------------------------------

export interface LaunchChromeOptions {
  binary: string;
  profileMode: 'dedicated' | 'real';
  /** Required when profileMode === 'dedicated'. */
  profileDir?: string;
  /**
   * When profileMode is 'real' and the user selected a specific sub-profile,
   * provide it here so we can pass --user-data-dir + --profile-directory.
   * When absent, Chrome picks its default profile (previous behaviour).
   */
  realProfile?: RealProfileSelection;
}

/**
 * Spawns Chrome with the given options. Returns the ChildProcess handle.
 *
 * Chrome is launched detached and unref()ed so it survives the CLI process.
 * Do NOT automatically kill the returned process — the user's Chrome should
 * remain open after the CLI exits.
 */
export function launchChrome(opts: LaunchChromeOptions): ChildProcess {
  const args: string[] = ['--no-first-run', '--no-default-browser-check'];

  if (opts.profileMode === 'dedicated') {
    if (!opts.profileDir) {
      throw new Error('launchChrome: profileDir is required when profileMode is "dedicated"');
    }
    args.push(`--user-data-dir=${opts.profileDir}`);
  } else if (opts.profileMode === 'real' && opts.realProfile) {
    // Real mode with a specific sub-profile selected by the user.
    // --user-data-dir targets the browser's installation data dir.
    // --profile-directory picks the sub-folder within that dir.
    // The singleton-forwarding path works fine here because cli2 doesn't
    // use CDP — the extension opens the WebSocket from inside Chrome.
    args.push(`--user-data-dir=${opts.realProfile.userDataDir}`);
    args.push(`--profile-directory=${opts.realProfile.profileName}`);
  }
  // else: real mode without a selection → no profile flags.
  // Chrome opens in whatever profile it considers "default".
  // The user must have already installed the extension in that profile via
  // chrome://extensions → Load unpacked.

  const child = spawn(opts.binary, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

// ---------------------------------------------------------------------------
// waitForExtensionHandshake
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to the extension dist directory for use in the
 * timeout error message. Falls back gracefully if resolution is not possible.
 */
function resolveExtensionDistPath(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // From dist/browser/chrome-launcher.js, go up to tools/ then into extension/dist
    const resolved = pathResolve(__dirname, '..', '..', '..', 'extension', 'dist');
    // Only return the resolved path if the dist actually exists — otherwise the
    // user sees a misleading path in the error message.
    if (existsSync(resolved)) return resolved;
    // Also try the alternative monorepo layout where cli2 and extension are peers
    // of the current working directory (e.g., running from a source checkout).
    const cwdFallback = pathResolve(process.cwd(), 'tools', 'extension', 'dist');
    if (existsSync(cwdFallback)) return cwdFallback;
    return resolved; // best-effort: still show the resolved path even if missing
  } catch {
    return 'tools/extension/dist';
  }
}

/**
 * Waits for the ExtensionHost to emit a 'connected' event within `timeoutMs`.
 * If the timeout fires, throws an error with a detailed troubleshooting checklist.
 *
 * When `realProfile` is provided (real-mode with a specific sub-profile), an
 * additional paragraph is appended to the error pointing the user to the exact
 * profile path where the extension must be installed.
 *
 * This error message is the primary onboarding signal — keep it accurate.
 */
export function waitForExtensionHandshake(
  host: ExtensionHost,
  timeoutMs: number,
  realProfile?: RealProfileSelection,
): Promise<void> {
  if (host.isConnected()) return Promise.resolve();

  const extensionDistPath = resolveExtensionDistPath();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const realProfileNote = realProfile
        ? `\n` +
          `Extra check for real-profile mode:\n` +
          `  → The PortalFlow extension must be loaded in the "${realProfile.displayName}" profile\n` +
          `    (at ${realProfile.userDataDir}/${realProfile.profileName}/Extensions/...).\n` +
          `  → Switch to that profile in Chrome's profile picker and reload\n` +
          `    chrome://extensions → Load unpacked to confirm it's installed there.\n`
        : '';

      reject(
        new Error(
          `Extension did not connect within 30 seconds.\n` +
          `\n` +
          `Checklist:\n` +
          `  1. Is Chrome running? (it should be — portalflow2 just launched it)\n` +
          `  2. Is the PortalFlow extension loaded?\n` +
          `     → Open chrome://extensions\n` +
          `     → Enable Developer mode (top-right toggle)\n` +
          `     → Click "Load unpacked"\n` +
          `     → Select: ${extensionDistPath}\n` +
          `  3. Is the extension version correct?\n` +
          `     → The extension must be built with \`npm -w tools/extension run build\` after any update.\n` +
          `  4. Is another process holding port 7667?\n` +
          `     → Kill the other process or set extension.port in ~/.portalflow/config.json to a free port.\n` +
          `\n` +
          `See tools/cli2/README.md for full setup instructions.\n` +
          realProfileNote,
        ),
      );
    }, timeoutMs);

    host.once('connected', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// LaunchResult
// ---------------------------------------------------------------------------

export interface LaunchResult {
  chromeProcess: ChildProcess;
  binary: string;
  profileMode: 'dedicated' | 'real';
}

// ---------------------------------------------------------------------------
// launchChromeAndWaitForExtension — high-level helper
// ---------------------------------------------------------------------------

/**
 * High-level helper that:
 *  1. Detects the Chrome binary.
 *  2. Spawns Chrome with the appropriate profile flags.
 *  3. Waits up to 30s for the extension to connect.
 *
 * On timeout the promise rejects with the detailed checklist error from
 * `waitForExtensionHandshake`. The caller is responsible for closing the
 * ExtensionHost on failure.
 *
 * @param host - Already-started ExtensionHost to wait on.
 * @param config - ExtensionConfig from user config. Must have profileMode set
 *                 to 'dedicated' or 'real' (never 'unset' — call
 *                 ensureProfileChoice first).
 * @param logger - Pino logger.
 */
export async function launchChromeAndWaitForExtension(
  host: ExtensionHost,
  config: ExtensionConfig,
  logger: pino.Logger,
): Promise<LaunchResult> {
  const profileMode = config.profileMode as 'dedicated' | 'real';
  const timeoutMs = 30_000;

  // Detect binary
  const binary = await detectChromeBinary(config.chromeBinary);
  logger.info({ binary, profileMode }, 'Chrome binary detected');

  // Spawn Chrome
  const chromeProcess = launchChrome({
    binary,
    profileMode,
    profileDir: config.profileDir,
    realProfile: config.realProfile,
  });
  logger.info({ pid: chromeProcess.pid, profileMode }, 'Chrome launched');

  // Wait for extension handshake
  logger.info(
    { timeoutMs },
    'Waiting for PortalFlow extension to connect...',
  );
  await waitForExtensionHandshake(host, timeoutMs, config.realProfile);
  logger.info('PortalFlow extension connected');

  return { chromeProcess, binary, profileMode };
}
