import OpenAI from 'openai';
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

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: LlmProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
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
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.elementFinder },
          { role: 'user', content: userMessage },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<ElementResult>(text, 'findElement');
    } catch (err) {
      logger.error({ err, description }, 'OpenAiProvider.findElement failed');
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
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.actionDecider },
          { role: 'user', content: userMessage },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<ActionDecision>(text, 'decideAction');
    } catch (err) {
      logger.error({ err, stepDescription }, 'OpenAiProvider.decideAction failed');
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
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.pageInterpreter },
          { role: 'user', content: userMessage },
        ],
      });

      return response.choices[0]?.message?.content ?? '';
    } catch (err) {
      logger.error({ err, question }, 'OpenAiProvider.interpretPage failed');
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
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.dataExtractor },
          { role: 'user', content: userMessage },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<unknown>(text, 'extractData');
    } catch (err) {
      logger.error({ err }, 'OpenAiProvider.extractData failed');
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
