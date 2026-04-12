import type { Page } from 'playwright';
import type { PageContext } from '../llm/provider.interface.js';

const DEFAULT_MAX_HTML_LENGTH = 50_000;

/**
 * Strips noise from raw HTML so the LLM receives a compact, readable snapshot
 * of the visible page state.
 *
 * Removes:
 *  - <script> and <style> blocks (and their contents)
 *  - <noscript> blocks
 *  - HTML comments
 *  - hidden elements (inline style="display:none" / visibility:hidden)
 * Then collapses consecutive whitespace and trims to maxLength.
 */
function simplifyHtml(raw: string, maxLength: number): string {
  let html = raw;

  // Remove block elements with their content
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Remove elements with obvious hidden inline styles
  html = html.replace(/<[^>]+style="[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\/[a-z]+>/gi, '');
  html = html.replace(/<[^>]+style="[^"]*visibility\s*:\s*hidden[^"]*"[^>]*>[\s\S]*?<\/[a-z]+>/gi, '');

  // Collapse whitespace
  html = html.replace(/\s{2,}/g, ' ').trim();

  if (html.length > maxLength) {
    html = html.slice(0, maxLength) + '\n<!-- [truncated] -->';
  }

  return html;
}

export interface CaptureOptions {
  includeScreenshot?: boolean;
  maxHtmlLength?: number;
}

export class PageContextCapture {
  constructor(private readonly getPage: () => Page) {}

  async capture(options?: CaptureOptions): Promise<PageContext> {
    const page = this.getPage();
    const maxHtmlLength = options?.maxHtmlLength ?? DEFAULT_MAX_HTML_LENGTH;

    const [url, title, rawHtml] = await Promise.all([
      Promise.resolve(page.url()),
      page.title(),
      page.content(),
    ]);

    const html = simplifyHtml(rawHtml, maxHtmlLength);

    const context: PageContext = { url, title, html };

    if (options?.includeScreenshot) {
      try {
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        context.screenshot = buffer.toString('base64');
      } catch {
        // Screenshot is optional — if it fails, omit it rather than aborting
      }
    }

    return context;
  }
}
