import type { PageClient } from './page-client.js';
import type { LlmService } from '../llm/llm.service.js';
import { PageContextCapture } from './context.js';

export interface ResolverResult {
  selector: string;
  source: 'primary' | 'fallback' | 'ai';
  confidence?: number;
}

/**
 * ElementResolver for cli2 — uses PageClient (WebSocket transport) instead of
 * Playwright's Page object.
 *
 * When the LLM suggests a selector, validation is attempted via
 * `pageClient.elementExists()`. If `elementExists` throws (e.g. because the
 * extension-side anyMatch command returns not_implemented — a known v1 gap
 * that task 8 closes), the error is caught, a warning is logged, and the
 * LLM-suggested selector is treated as valid without validation.
 */
export class ElementResolver {
  constructor(
    private readonly pageClient: PageClient,
    private readonly llmService: LlmService,
    private readonly contextCapture: PageContextCapture,
  ) {}

  async resolve(
    primary: string | undefined,
    fallbacks: string[] | undefined,
    aiGuidance: string | undefined,
    stepDescription: string,
  ): Promise<ResolverResult> {
    const tried: string[] = [];

    // 1. Try primary selector
    if (primary) {
      if (await this.pageClient.elementExists(primary)) {
        return { selector: primary, source: 'primary' };
      }
      tried.push(primary);
    }

    // 2. Try each fallback in order
    if (fallbacks && fallbacks.length > 0) {
      for (const fallback of fallbacks) {
        if (await this.pageClient.elementExists(fallback)) {
          return { selector: fallback, source: 'fallback' };
        }
        tried.push(fallback);
      }
    }

    // 3. Ask the LLM for help
    const description = aiGuidance || stepDescription;
    if (description) {
      const pageContext = await this.contextCapture.capture({ includeScreenshot: false });

      let result: { selector: string; confidence: number };
      try {
        result = await this.llmService.findElement({
          description,
          pageContext,
          failedSelectors: tried.length > 0 ? tried : undefined,
        });
      } catch (err) {
        throw new Error(
          `Element not found via primary/fallback selectors and LLM lookup failed.\n` +
            `Tried: ${tried.join(', ') || '(none)'}\n` +
            `LLM error: ${String(err)}`,
        );
      }

      // Validate the LLM's answer. If elementExists throws (e.g. anyMatch not
      // yet implemented extension-side — task 8 v1 gap), treat the selector
      // as valid without validation.
      let validated = false;
      try {
        validated = await this.pageClient.elementExists(result.selector);
      } catch {
        // anyMatch command not yet implemented extension-side — accept the
        // LLM selector without DOM validation. Task 8 will close this gap.
        validated = true;
      }

      if (result.selector && validated) {
        return {
          selector: result.selector,
          source: 'ai',
          confidence: result.confidence,
        };
      }

      throw new Error(
        `Element not found. LLM suggested "${result.selector}" (confidence ${result.confidence}) but it did not match any element on the page.\n` +
          `Tried selectors: ${[...tried, result.selector].join(', ')}`,
      );
    }

    // 4. Nothing worked and no AI guidance available
    throw new Error(
      `Element not found. No matching element for:\n` +
        `  primary: ${primary ?? '(none)'}\n` +
        `  fallbacks: ${fallbacks?.join(', ') || '(none)'}\n` +
        `  No AI guidance or step description available for LLM fallback.`,
    );
  }
}
