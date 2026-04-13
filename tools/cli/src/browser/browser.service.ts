import { mkdirSync } from 'fs';
import { join } from 'path';
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
