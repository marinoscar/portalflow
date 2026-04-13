import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Download, Page } from 'playwright';

const DEFAULT_TIMEOUT = 30_000;

export class PageService {
  constructor(
    private readonly getPage: () => Page,
    private readonly getDownloadDir?: () => string,
  ) {}

  async navigate(url: string): Promise<void> {
    try {
      await this.getPage().goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`navigate("${url}") failed: ${String(err)}`);
    }
  }

  async click(selector: string): Promise<void> {
    try {
      await this.getPage().click(selector, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`click("${selector}") failed: ${String(err)}`);
    }
  }

  async type(selector: string, text: string): Promise<void> {
    try {
      await this.getPage().fill(selector, text, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`type("${selector}") failed: ${String(err)}`);
    }
  }

  async selectOption(selector: string, value: string): Promise<void> {
    try {
      await this.getPage().selectOption(selector, value, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`selectOption("${selector}", "${value}") failed: ${String(err)}`);
    }
  }

  async check(selector: string): Promise<void> {
    try {
      await this.getPage().check(selector, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`check("${selector}") failed: ${String(err)}`);
    }
  }

  async uncheck(selector: string): Promise<void> {
    try {
      await this.getPage().uncheck(selector, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`uncheck("${selector}") failed: ${String(err)}`);
    }
  }

  async hover(selector: string): Promise<void> {
    try {
      await this.getPage().hover(selector, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`hover("${selector}") failed: ${String(err)}`);
    }
  }

  async focus(selector: string): Promise<void> {
    try {
      await this.getPage().focus(selector, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`focus("${selector}") failed: ${String(err)}`);
    }
  }

  async waitForSelector(selector: string, timeout?: number): Promise<void> {
    try {
      await this.getPage().waitForSelector(selector, {
        timeout: timeout ?? DEFAULT_TIMEOUT,
        state: 'visible',
      });
    } catch (err) {
      throw new Error(`waitForSelector("${selector}") timed out: ${String(err)}`);
    }
  }

  async waitForNavigation(urlPattern?: string, timeout?: number): Promise<void> {
    try {
      const page = this.getPage();
      if (urlPattern) {
        await page.waitForURL(urlPattern, { timeout: timeout ?? DEFAULT_TIMEOUT });
      } else {
        await page.waitForLoadState('domcontentloaded', { timeout: timeout ?? DEFAULT_TIMEOUT });
      }
    } catch (err) {
      throw new Error(`waitForNavigation(${urlPattern ?? ''}) failed: ${String(err)}`);
    }
  }

  async waitForNetworkIdle(timeout?: number): Promise<void> {
    try {
      await this.getPage().waitForLoadState('networkidle', {
        timeout: timeout ?? DEFAULT_TIMEOUT,
      });
    } catch (err) {
      throw new Error(`waitForNetworkIdle() failed: ${String(err)}`);
    }
  }

  async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  async getText(selector: string): Promise<string> {
    try {
      const text = await this.getPage().textContent(selector, { timeout: DEFAULT_TIMEOUT });
      return text ?? '';
    } catch (err) {
      throw new Error(`getText("${selector}") failed: ${String(err)}`);
    }
  }

  async getAttribute(selector: string, attribute: string): Promise<string | null> {
    try {
      return await this.getPage().getAttribute(selector, attribute, { timeout: DEFAULT_TIMEOUT });
    } catch (err) {
      throw new Error(`getAttribute("${selector}", "${attribute}") failed: ${String(err)}`);
    }
  }

  async getHtml(selector?: string): Promise<string> {
    try {
      const page = this.getPage();
      if (selector) {
        const element = await page.$(selector);
        if (!element) {
          throw new Error(`Element not found: "${selector}"`);
        }
        return await element.innerHTML();
      }
      return await page.content();
    } catch (err) {
      throw new Error(`getHtml(${selector ? `"${selector}"` : ''}) failed: ${String(err)}`);
    }
  }

  async getUrl(): Promise<string> {
    return this.getPage().url();
  }

  async getTitle(): Promise<string> {
    try {
      return await this.getPage().title();
    } catch (err) {
      throw new Error(`getTitle() failed: ${String(err)}`);
    }
  }

  async elementExists(selector: string): Promise<boolean> {
    try {
      const element = await this.getPage().$(selector);
      return element !== null;
    } catch {
      return false;
    }
  }

  async waitForDownload(
    triggerAction: () => Promise<void>,
    timeout?: number,
  ): Promise<string> {
    const page = this.getPage();
    const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;

    let download: Download;
    try {
      [download] = await Promise.all([
        page.waitForEvent('download', { timeout: effectiveTimeout }),
        triggerAction(),
      ]);
    } catch (err) {
      throw new Error(`waitForDownload() failed to capture download event: ${String(err)}`);
    }

    // If a download directory is configured, save the file there using the
    // suggested filename. Otherwise fall back to the Playwright default temp path.
    if (this.getDownloadDir) {
      try {
        const downloadDir = this.getDownloadDir();
        mkdirSync(downloadDir, { recursive: true });
        const suggested = download.suggestedFilename();
        const destPath = join(downloadDir, suggested);
        await download.saveAs(destPath);
        return destPath;
      } catch (err) {
        throw new Error(`waitForDownload() could not save download to configured dir: ${String(err)}`);
      }
    }

    try {
      const path = await download.path();
      if (!path) {
        throw new Error('Download path is null — download may have failed.');
      }
      return path;
    } catch (err) {
      throw new Error(`waitForDownload() could not resolve download path: ${String(err)}`);
    }
  }
}
