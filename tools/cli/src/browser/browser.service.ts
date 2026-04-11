import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';

export interface BrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  artifactDir?: string;
}

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private artifactDir: string = '.';

  async launch(options: BrowserOptions): Promise<void> {
    const { chromium } = await import('playwright');

    this.artifactDir = options.artifactDir ?? '.';

    // Ensure artifact directory exists
    try {
      mkdirSync(this.artifactDir, { recursive: true });
    } catch {
      // Directory already exists or cannot be created — continue
    }

    this.browser = await chromium.launch({
      headless: options.headless ?? false,
    });

    const contextOptions: Parameters<Browser['newContext']>[0] = {
      acceptDownloads: true,
      downloadsPath: this.artifactDir,
    };

    if (options.viewport) {
      contextOptions.viewport = options.viewport;
    }

    if (options.userAgent) {
      contextOptions.userAgent = options.userAgent;
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

  async screenshot(name: string): Promise<string> {
    const page = this.getPage();
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = join(this.artifactDir, `${sanitized}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  }

  async close(): Promise<void> {
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
  }
}
