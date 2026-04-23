import type { PageClient } from './page-client.js';
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

/**
 * PageContextCapture for cli2 — uses PageClient (WebSocket transport) instead
 * of Playwright's Page object.
 *
 * v1 limitations (task 7):
 *   - cookies: not available via current PageClient surface; omitted.
 *     Task 8/9 may add a dedicated runtime storage command.
 *   - localStorage: same reason; omitted.
 *   - screenshot: depends on the screenshot extension command, which is not
 *     yet implemented extension-side (task 8). Capture is attempted; if it
 *     throws, the error is logged and context.screenshot is left undefined.
 */
export class PageContextCapture {
  constructor(private readonly pageClient: PageClient) {}

  async capture(options?: CaptureOptions): Promise<PageContext> {
    const maxHtmlLength = options?.maxHtmlLength ?? DEFAULT_MAX_HTML_LENGTH;

    const [url, title, rawHtml] = await Promise.all([
      this.pageClient.getUrl(),
      this.pageClient.getTitle(),
      this.pageClient.getHtml(),
    ]);

    const html = simplifyHtml(rawHtml, maxHtmlLength);

    const context: PageContext = { url, title, html };

    if (options?.includeScreenshot) {
      try {
        const screenshotPath = await this.pageClient.screenshot();
        // Read the file and base64-encode it for the LLM.
        const { readFile } = await import('node:fs/promises');
        const buffer = await readFile(screenshotPath);
        context.screenshot = buffer.toString('base64');
      } catch {
        // Screenshot is optional — if it fails (e.g. extension-side command
        // not yet implemented in task 7), omit it rather than aborting.
        // The aiscope's includeScreenshot path will simply have no screenshot
        // until task 8 ships the screenshot extension handler.
      }
    }

    return context;
  }
}
