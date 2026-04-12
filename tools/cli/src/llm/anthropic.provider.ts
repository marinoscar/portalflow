import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import type {
  ActionDecision,
  ElementQuery,
  ElementResult,
  LlmProvider,
  LlmProviderConfig,
  PageContext,
} from './provider.interface.js';
import { SYSTEM_PROMPTS } from './prompts.js';

const MAX_HTML_CHARS = 50_000;
const logger = pino({ level: 'info' });

function truncateHtml(html: string): string {
  if (html.length <= MAX_HTML_CHARS) return html;
  return html.slice(0, MAX_HTML_CHARS) + '\n<!-- [HTML truncated] -->';
}

function parseJsonResponse<T>(text: string, context: string): T {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(`Failed to parse ${context} JSON response: ${String(err)}\nRaw: ${text}`);
  }
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: LlmProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
  }

  async findElement(query: ElementQuery): Promise<ElementResult> {
    const { description, pageContext, failedSelectors } = query;
    const failedNote =
      failedSelectors && failedSelectors.length > 0
        ? `\n\nSelectors that already failed: ${failedSelectors.join(', ')}`
        : '';

    const userMessage = `Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}

Find this element: ${description}${failedNote}`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: SYSTEM_PROMPTS.elementFinder,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<ElementResult>(text, 'findElement');
    } catch (err) {
      logger.error({ err, description }, 'AnthropicProvider.findElement failed');
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async decideAction(
    stepDescription: string,
    pageContext: PageContext,
    automationGoal: string,
  ): Promise<ActionDecision> {
    const userMessage = `Automation goal: ${automationGoal}

Current step: ${stepDescription}

Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: SYSTEM_PROMPTS.actionDecider,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<ActionDecision>(text, 'decideAction');
    } catch (err) {
      logger.error({ err, stepDescription }, 'AnthropicProvider.decideAction failed');
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async interpretPage(pageContext: PageContext, question: string): Promise<string> {
    const userMessage = `Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}

Question: ${question}`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPTS.pageInterpreter,
        messages: [{ role: 'user', content: userMessage }],
      });

      return response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');
    } catch (err) {
      logger.error({ err, question }, 'AnthropicProvider.interpretPage failed');
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async extractData(pageContext: PageContext, schema: string): Promise<unknown> {
    const userMessage = `Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}

Extract data matching this schema:
${schema}`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPTS.dataExtractor,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<unknown>(text, 'extractData');
    } catch (err) {
      logger.error({ err }, 'AnthropicProvider.extractData failed');
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
