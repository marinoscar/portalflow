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
  html?: string;
}

export interface VideoConfig {
  enabled?: boolean;
  width?: number;
  height?: number;
}

/**
 * Persisted defaults for `portalflow agent "<goal>"` (goal-driven mode).
 * Every field is optional; `resolveAgentDefaults` fills missing fields
 * from built-in defaults. Lets users tune budgets and mode once instead
 * of passing flags on every invocation.
 *
 * Precedence at runtime: CLI flag > this config > built-in default.
 */
export interface AgentDefaultsConfig {
  /** 'fast' = one LLM call per iteration; 'agent' = planner+milestones. */
  mode?: 'fast' | 'agent';
  /** Cap on actions the LLM can take. Top-level goals usually need >25. */
  maxIterations?: number;
  /** Wall-clock cap in seconds. Top-level goals usually need >300. */
  maxDuration?: number;
  /** Replans allowed in 'agent' mode before the runner gives up. */
  maxReplans?: number;
  /** Whether to capture the viewport and feed it to the LLM each iteration. */
  includeScreenshot?: boolean;
  /** Optional default URL to navigate to before handing off to the LLM. */
  startUrl?: string;
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
  channel?: BrowserChannel;
  /** Absolute path to a user data directory. */
  userDataDir?: string;
  /** Sub-profile inside the user data directory (e.g. 'Default', 'Profile 1'). */
  profileDirectory?: string;
  /**
   * When true, apply a curated set of automation-hiding patches to every
   * browser context — strip `--enable-automation`, inject a stealth init
   * script that masks `navigator.webdriver` / `window.chrome` / plugins /
   * WebGL vendor strings / permissions leak / etc.
   *
   * Default: false (opt-in). Enabling stealth occasionally breaks sites
   * that sanity-check the browser fingerprint, so it is not on by default.
   * See docs/AUTOMATION-JSON-SPEC.md for the list of evasions applied.
   */
  stealth?: boolean;
}

/**
 * Persisted selection of a specific Chrome sub-profile for "real" profile mode.
 *
 * When the user picks a profile via the TUI, all four fields are stored so the
 * settings display can show a human-friendly summary without re-reading the
 * filesystem.
 */
export interface RealProfileSelection {
  /** Absolute path to Chrome's user data directory, e.g. "/home/user/.config/google-chrome". */
  userDataDir: string;
  /** Sub-profile directory name, e.g. "Default" or "Profile 1". */
  profileName: string;
  /** Human-readable display name from Chrome's Local State metadata. */
  displayName: string;
  /** Friendly browser name, e.g. "Google Chrome". */
  browser: string;
}

export interface ExtensionConfig {
  host: string;              // default: '127.0.0.1'
  port: number;              // default: 7667
  chromeBinary?: string;     // optional override; auto-detected otherwise
  profileMode: 'dedicated' | 'real' | 'unset'; // 'unset' triggers first-run prompt
  profileDir?: string;       // when profileMode === 'dedicated'
  /** When profileMode is 'real', the specific sub-profile to launch into.
   *  When undefined, Chrome picks its default profile. */
  realProfile?: RealProfileSelection;
  closeWindowOnFinish: boolean; // default: false
}

export function defaultExtensionConfig(): ExtensionConfig {
  return {
    host: '127.0.0.1',
    port: 7667,
    profileMode: 'unset',
    closeWindowOnFinish: false,
  };
}

export interface CliConfig {
  activeProvider?: string;
  providers?: Record<string, ProviderConfig>;
  paths?: PathsConfig;
  video?: VideoConfig;
  logging?: LoggingConfig;
  browser?: BrowserConfig;
  extension?: ExtensionConfig;
  agent?: AgentDefaultsConfig;
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
    const config = JSON.parse(raw) as CliConfig;
    // Fall back to defaultExtensionConfig when extension section is absent.
    if (!config.extension) {
      config.extension = defaultExtensionConfig();
    }
    return config;
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

  async getAgentDefaults(): Promise<AgentDefaultsConfig> {
    const config = await this.load();
    return config.agent ?? {};
  }

  /**
   * Merge `partial` into the persisted agent defaults. Pass a field as
   * `null` to clear it (e.g. `setAgentDefaults({ startUrl: null })`).
   * Any field not mentioned is left untouched.
   */
  async setAgentDefaults(
    partial: Partial<{ [K in keyof AgentDefaultsConfig]: AgentDefaultsConfig[K] | null }>,
  ): Promise<void> {
    const config = await this.load();
    const current: AgentDefaultsConfig = { ...(config.agent ?? {}) };
    for (const [k, v] of Object.entries(partial)) {
      if (v === null) {
        delete (current as Record<string, unknown>)[k];
      } else if (v !== undefined) {
        (current as Record<string, unknown>)[k] = v;
      }
    }
    config.agent = current;
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

  async getExtension(): Promise<ExtensionConfig> {
    const config = await this.load();
    return config.extension ?? defaultExtensionConfig();
  }

  async setExtension(extension: Partial<ExtensionConfig>): Promise<void> {
    const config = await this.load();
    config.extension = { ...(config.extension ?? defaultExtensionConfig()), ...extension };
    await this.save(config);
  }
}
