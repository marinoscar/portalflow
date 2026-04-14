import { mkdirSync } from 'fs';
import { join } from 'path';
import type pino from 'pino';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserChannel, BrowserMode } from '../config/config.service.js';

export interface BrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  // Separate directories for each artifact type
  screenshotDir: string;
  videoDir: string;
  downloadDir: string;
  // Video recording
  recordVideo?: boolean;
  videoSize?: { width: number; height: number };
  // Legacy (kept for backward compat, falls back to screenshotDir)
  artifactDir?: string;

  // ---- Browser profile (added for persistent-context mode) ----
  /** "isolated" (default) or "persistent". */
  mode?: BrowserMode;
  /** Which Chromium-family binary to launch. Only used in persistent mode. */
  channel?: BrowserChannel;
  /** Path to the user data directory. Required when mode === "persistent". */
  userDataDir?: string;
  /** Sub-profile name inside the user data dir, e.g. "Default" or "Profile 1". */
  profileDirectory?: string;
}

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private screenshotDir: string = '.';
  private videoDir: string = '.';
  private downloadDir: string = '.';
  private videoEnabled: boolean = false;
  private logger?: pino.Logger;

  constructor(logger?: pino.Logger) {
    this.logger = logger;
  }

  async launch(options: BrowserOptions): Promise<void> {
    const { chromium } = await import('playwright');

    this.screenshotDir = options.screenshotDir ?? options.artifactDir ?? '.';
    this.videoDir = options.videoDir ?? '.';
    this.downloadDir = options.downloadDir ?? '.';
    this.videoEnabled = options.recordVideo ?? false;

    // Ensure all artifact directories exist
    for (const dir of [this.screenshotDir, this.videoDir, this.downloadDir]) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // Directory already exists or cannot be created — continue
      }
    }

    const mode: BrowserMode = options.mode ?? 'isolated';

    if (mode === 'persistent') {
      await this.launchPersistent(chromium, options);
    } else {
      await this.launchIsolated(chromium, options);
    }

    // Wire page lifecycle events to the run logger. Events are logged at
    // debug level (noisy but useful during troubleshooting); only genuine
    // errors (page crashes, uncaught exceptions, failed requests) bubble
    // up to warn. When no logger is injected we skip wiring — the
    // listeners would otherwise hold references to a no-op logger and
    // clutter the event loop for every page transition.
    if (this.logger && this.page) {
      this.attachPageLifecycleListeners(this.page, this.logger);
    }
  }

  /**
   * Launch a fresh in-memory Chromium context. No on-disk profile, no
   * cookies persist between runs. Matches the original CLI behavior.
   */
  private async launchIsolated(
    chromium: typeof import('playwright').chromium,
    options: BrowserOptions,
  ): Promise<void> {
    this.browser = await chromium.launch({
      headless: options.headless ?? false,
    });

    const contextOptions: {
      acceptDownloads: boolean;
      viewport?: { width: number; height: number };
      userAgent?: string;
      recordVideo?: { dir: string; size?: { width: number; height: number } };
    } = {
      acceptDownloads: true,
    };

    if (options.viewport) contextOptions.viewport = options.viewport;
    if (options.userAgent) contextOptions.userAgent = options.userAgent;
    if (this.videoEnabled) {
      contextOptions.recordVideo = {
        dir: this.videoDir,
        size: options.videoSize ?? { width: 1280, height: 720 },
      };
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    this.logger?.info(
      { mode: 'isolated', channel: 'chromium' },
      'browser launched (fresh in-memory context)',
    );
  }

  /**
   * Launch a real on-disk Chrome / Brave / Edge profile via Playwright's
   * launchPersistentContext. The user data dir holds cookies, localStorage,
   * extensions, saved logins, and history — all of which carry over from
   * the previous run. This makes automations behave exactly like a returning
   * human user from their normal browser.
   *
   * Two important caveats are handled here:
   *
   * 1. **Profile lock**: Chrome refuses to open the same user data
   *    directory from two processes simultaneously. If the user has their
   *    normal browser open with this profile, Playwright will fail with
   *    a "ProcessSingleton" / lock-related error. We catch that error and
   *    re-throw with a clear message telling the user to close their
   *    browser or pick a different profile.
   *
   * 2. **Sub-profile selection**: a user data directory can contain many
   *    profiles ("Default", "Profile 1", etc). Playwright's
   *    launchPersistentContext only takes the user data dir, not the
   *    sub-profile, so we forward the choice via the standard Chromium
   *    `--profile-directory=<name>` command-line argument.
   */
  private async launchPersistent(
    chromium: typeof import('playwright').chromium,
    options: BrowserOptions,
  ): Promise<void> {
    if (!options.userDataDir) {
      throw new Error(
        'browser.mode is "persistent" but no userDataDir was provided. ' +
          'Run `portalflow settings browser` to pick a profile, or pass --browser-user-data-dir on the command line.',
      );
    }

    const launchArgs: string[] = [];
    if (options.profileDirectory) {
      launchArgs.push(`--profile-directory=${options.profileDirectory}`);
    }

    const persistentOptions: {
      headless: boolean;
      acceptDownloads: boolean;
      channel?: BrowserChannel;
      args: string[];
      viewport?: { width: number; height: number };
      userAgent?: string;
      recordVideo?: { dir: string; size?: { width: number; height: number } };
    } = {
      headless: options.headless ?? false,
      acceptDownloads: true,
      args: launchArgs,
    };

    if (options.channel && options.channel !== 'chromium') {
      persistentOptions.channel = options.channel;
    }
    if (options.viewport) persistentOptions.viewport = options.viewport;
    if (options.userAgent) persistentOptions.userAgent = options.userAgent;
    if (this.videoEnabled) {
      persistentOptions.recordVideo = {
        dir: this.videoDir,
        size: options.videoSize ?? { width: 1280, height: 720 },
      };
    }

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(
        options.userDataDir,
        persistentOptions,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Detect the most common lock error and translate it.
      if (
        message.includes('SingletonLock') ||
        message.includes('ProcessSingleton') ||
        message.includes('user data directory is already in use') ||
        message.toLowerCase().includes('profile directory is in use')
      ) {
        throw new Error(
          `Cannot open the browser profile at "${options.userDataDir}"${
            options.profileDirectory ? ` (profile "${options.profileDirectory}")` : ''
          } — it is already in use by another browser process. Close your browser windows that use this profile and try again, or pick a different profile via \`portalflow settings browser\`.\n\nUnderlying error: ${message}`,
        );
      }
      throw err;
    }

    this.context = context;
    // Persistent context comes with a default page already open. Reuse it
    // when present; otherwise create a fresh one. This matters because some
    // browsers restore the previous tab on launch and we want to act on it.
    const existingPages = context.pages();
    if (existingPages.length > 0 && !existingPages[0]!.isClosed()) {
      this.page = existingPages[0]!;
    } else {
      this.page = await context.newPage();
    }

    this.logger?.info(
      {
        mode: 'persistent',
        channel: options.channel ?? 'chromium',
        userDataDir: options.userDataDir,
        profileDirectory: options.profileDirectory ?? 'Default',
      },
      'browser launched (persistent context — real profile)',
    );
  }

  private attachPageLifecycleListeners(page: Page, logger: pino.Logger): void {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        logger.debug({ url: frame.url() }, 'page navigated');
      }
    });

    page.on('load', () => {
      logger.debug({ url: page.url() }, 'page load event');
    });

    page.on('domcontentloaded', () => {
      logger.debug({ url: page.url() }, 'page domcontentloaded');
    });

    page.on('pageerror', (err) => {
      logger.warn(
        { err, url: page.url() },
        'page uncaught exception (JS runtime error)',
      );
    });

    page.on('crash', () => {
      logger.error({ url: page.url() }, 'page crashed');
    });

    page.on('dialog', (dialog) => {
      logger.debug(
        { type: dialog.type(), message: dialog.message(), url: page.url() },
        'page dialog opened (auto-dismissed by default)',
      );
    });

    page.on('console', (msg) => {
      const type = msg.type();
      // Only surface error/warning console messages at debug — info/log
      // messages from the page are noisy and rarely useful for automation
      // debugging. Users who need full visibility can lift to trace level
      // by wrapping with a secondary listener externally.
      if (type === 'error' || type === 'warning') {
        logger.debug(
          { type, text: msg.text(), url: page.url() },
          'page console',
        );
      }
    });

    page.on('requestfailed', (request) => {
      logger.debug(
        {
          url: request.url(),
          method: request.method(),
          failure: request.failure()?.errorText ?? null,
          resourceType: request.resourceType(),
        },
        'page request failed',
      );
    });

    page.on('response', (response) => {
      const status = response.status();
      // Only log non-2xx responses at debug — a full request trail would
      // drown out everything else. This gives just enough signal to
      // catch redirects, 4xx/5xx errors, and auth redirects.
      if (status >= 300) {
        logger.debug(
          {
            url: response.url(),
            status,
            method: response.request().method(),
          },
          'page response (non-2xx)',
        );
      }
    });
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error(
        'No active page. Call launch() before accessing the page.',
      );
    }
    return this.page;
  }

  getDownloadDir(): string {
    return this.downloadDir;
  }

  async screenshot(name: string): Promise<string> {
    const page = this.getPage();
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = join(this.screenshotDir, `${sanitized}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  }

  async close(): Promise<{ videoPaths: string[] }> {
    const videoPaths: string[] = [];

    // Collect video path BEFORE closing context — the path is known up front
    // even though the file is only written after context.close()
    if (this.videoEnabled && this.page && !this.page.isClosed()) {
      try {
        const video = this.page.video();
        if (video) {
          const videoPath = await video.path();
          if (videoPath) videoPaths.push(videoPath);
        }
      } catch {
        // Non-fatal — continue with close
      }
    }

    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    } catch {
      // Ignore errors during page close
    }

    try {
      await this.context?.close();
    } catch {
      // Ignore errors during context close
    }

    try {
      await this.browser?.close();
    } catch {
      // Ignore errors during browser close
    }

    this.page = null;
    this.context = null;
    this.browser = null;

    return { videoPaths };
  }
}
