import type { Page } from 'playwright';
import type { LlmService } from '../llm/llm.service.js';
import { PageContextCapture } from './context.js';

export interface ResolverResult {
  selector: string;
  source: 'primary' | 'fallback' | 'ai';
  confidence?: number;
}

async function elementExists(page: Page, selector: string): Promise<boolean> {
  try {
    const element = await page.$(selector);
    return element !== null;
  } catch {
    return false;
  }
}

export class ElementResolver {
  constructor(
    private readonly getPage: () => Page,
    private readonly llmService: LlmService,
    private readonly contextCapture: PageContextCapture,
  ) {}

  async resolve(
    primary: string | undefined,
    fallbacks: string[] | undefined,
    aiGuidance: string | undefined,
    stepDescription: string,
  ): Promise<ResolverResult> {
    const page = this.getPage();
    const tried: string[] = [];

    // 1. Try primary selector
    if (primary) {
      if (await elementExists(page, primary)) {
        return { selector: primary, source: 'primary' };
      }
      tried.push(primary);
    }

    // 2. Try each fallback in order
    if (fallbacks && fallbacks.length > 0) {
      for (const fallback of fallbacks) {
        if (await elementExists(page, fallback)) {
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

      if (result.selector && (await elementExists(page, result.selector))) {
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
