import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ProviderKind } from '../llm/provider-kinds.js';

export interface ProviderConfig {
  kind?: ProviderKind;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  [key: string]: string | undefined;
}

export interface PathsConfig {
  automations?: string;
  screenshots?: string;
  videos?: string;
  downloads?: string;
}

export interface VideoConfig {
  enabled?: boolean;
  width?: number;
  height?: number;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export interface LoggingConfig {
  /** Minimum log level. Default: "info". */
  level?: LogLevel;
  /** Optional file path. When set, logs are written to this file IN ADDITION to stdout. */
  file?: string;
  /** Prettify stdout output with pino-pretty. Default: true. */
  pretty?: boolean;
  /** Redact values of inputs whose type is "secret". Default: true. */
  redactSecrets?: boolean;
}

/**
 * Browser launch mode.
 *
 * - `isolated`   — Playwright launches a fresh in-memory Chromium context
 *                  for every run. No cookies, extensions, or sign-in state
 *                  carry across runs. Default. Matches the original CLI
 *                  behavior — fast, repeatable, and zero side effects.
 *
 * - `persistent` — Playwright opens (or creates) a real on-disk user data
 *                  directory via `launchPersistentContext`. Cookies,
 *                  localStorage, saved logins, extensions, and history all
 *                  persist between runs. When pointed at an existing Chrome
 *                  / Brave / Edge profile, the run looks (to the website)
 *                  like a returning human user from your normal browser.
 *                  This is the recommended mode for portals that fingerprint
 *                  bot-like contexts or that depend on long-lived sessions.
 *
 *                  IMPORTANT: a Chrome user data directory cannot be opened
 *                  by two processes at the same time. If your normal browser
 *                  is running with the same profile, the launch will fail
 *                  with a profile-locked error. Close your browser first or
 *                  use a profile you don't have open.
 */
export type BrowserMode = 'isolated' | 'persistent';

/**
 * Which Chromium-family binary to launch. When omitted, Playwright's bundled
 * Chromium is used. Set to `chrome` / `chrome-beta` / `chrome-dev` / `msedge`
 * etc. to launch the user's installed browser instead — necessary for sites
 * that fingerprint pure Chromium and required to share cookies + extensions
 * with the user's daily-driver browser.
 */
export type BrowserChannel =
  | 'chromium'
  | 'chrome'
  | 'chrome-beta'
  | 'chrome-dev'
  | 'msedge'
  | 'msedge-beta'
  | 'msedge-dev';

export interface BrowserConfig {
  mode?: BrowserMode;
  channel?: BrowserChannel;
  /** Absolute path to a user data directory. Required when mode === 'persistent'. */
  userDataDir?: string;
  /** Sub-profile inside the user data directory (e.g. 'Default', 'Profile 1'). */
  profileDirectory?: string;
}

export interface CliConfig {
  activeProvider?: string;
  providers?: Record<string, ProviderConfig>;
  paths?: PathsConfig;
  video?: VideoConfig;
  logging?: LoggingConfig;
  browser?: BrowserConfig;
}

export class ConfigService {
  private readonly configDir: string;
  private readonly configFile: string;

  constructor() {
    this.configDir = join(homedir(), '.portalflow');
    this.configFile = join(this.configDir, 'config.json');
  }

  async load(): Promise<CliConfig> {
    if (!existsSync(this.configFile)) {
      return {};
    }
    const raw = await readFile(this.configFile, 'utf-8');
    return JSON.parse(raw) as CliConfig;
  }

  async save(config: CliConfig): Promise<void> {
    if (!existsSync(this.configDir)) {
      await mkdir(this.configDir, { recursive: true });
    }
    await writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
  }

  async getActiveProvider(): Promise<string | undefined> {
    const config = await this.load();
    return config.activeProvider;
  }

  async setActiveProvider(name: string): Promise<void> {
    const config = await this.load();
    config.activeProvider = name;
    await this.save(config);
  }

  async setProviderConfig(name: string, providerConfig: ProviderConfig): Promise<void> {
    const config = await this.load();
    config.providers ??= {};
    config.providers[name] = {
      ...(config.providers[name] ?? {}),
      ...providerConfig,
    };
    await this.save(config);
  }

  /**
   * Reset the entire configuration file by deleting it.
   * After this call, `load()` returns an empty config as if the CLI had never been configured.
   */
  async reset(): Promise<void> {
    if (existsSync(this.configFile)) {
      await unlink(this.configFile);
    }
  }

  async getPaths(): Promise<PathsConfig> {
    const config = await this.load();
    return config.paths ?? {};
  }

  async setPaths(paths: Partial<PathsConfig>): Promise<void> {
    const config = await this.load();
    config.paths = { ...(config.paths ?? {}), ...paths };
    await this.save(config);
  }

  async getVideo(): Promise<VideoConfig> {
    const config = await this.load();
    return config.video ?? {};
  }

  async setVideo(video: Partial<VideoConfig>): Promise<void> {
    const config = await this.load();
    config.video = { ...(config.video ?? {}), ...video };
    await this.save(config);
  }

  async getLogging(): Promise<LoggingConfig> {
    const config = await this.load();
    return config.logging ?? {};
  }

  async setLogging(logging: Partial<LoggingConfig>): Promise<void> {
    const config = await this.load();
    config.logging = { ...(config.logging ?? {}), ...logging };
    await this.save(config);
  }

  async getBrowser(): Promise<BrowserConfig> {
    const config = await this.load();
    return config.browser ?? {};
  }

  async setBrowser(browser: Partial<BrowserConfig>): Promise<void> {
    const config = await this.load();
    config.browser = { ...(config.browser ?? {}), ...browser };
    await this.save(config);
  }
}
