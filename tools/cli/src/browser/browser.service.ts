import { mkdirSync } from 'fs';
import { join } from 'path';
import type pino from 'pino';
import type { Browser, BrowserContext, Page } from 'playwright';

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

    if (options.viewport) {
      contextOptions.viewport = options.viewport;
    }

    if (options.userAgent) {
      contextOptions.userAgent = options.userAgent;
    }

    if (this.videoEnabled) {
      contextOptions.recordVideo = {
        dir: this.videoDir,
        size: options.videoSize ?? { width: 1280, height: 720 },
      };
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    // Wire page lifecycle events to the run logger. Events are logged at
    // debug level (noisy but useful during troubleshooting); only genuine
    // errors (page crashes, uncaught exceptions, failed requests) bubble
    // up to warn. When no logger is injected we skip wiring — the
    // listeners would otherwise hold references to a no-op logger and
    // clutter the event loop for every page transition.
    if (this.logger) {
      this.attachPageLifecycleListeners(this.page, this.logger);
    }
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
