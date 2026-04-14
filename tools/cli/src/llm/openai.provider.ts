import OpenAI from 'openai';
import pino from 'pino';
import type {
  ActionDecision,
  ConditionEvaluation,
  ConditionQuery,
  ElementQuery,
  ElementResult,
  ItemsQuery,
  ItemsResult,
  LlmProvider,
  LlmProviderConfig,
  PageContext,
} from './provider.interface.js';
import { SYSTEM_PROMPTS } from './prompts.js';

const MAX_HTML_CHARS = 50_000;

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
  private readonly logger: pino.Logger;

  constructor(config: LlmProviderConfig, logger?: pino.Logger) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.model = config.model;
    this.logger = logger ?? pino({ level: 'silent' });
  }

  private logCall(
    operation: string,
    startTs: number,
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
    extra?: Record<string, unknown>,
  ): void {
    this.logger.debug(
      {
        provider: 'openai',
        model: this.model,
        operation,
        latencyMs: Date.now() - startTs,
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        ...extra,
      },
      'llm call',
    );
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

    const t0 = Date.now();
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

      this.logCall('findElement', t0, response.usage, {
        description,
        failedSelectorCount: failedSelectors?.length ?? 0,
      });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<ElementResult>(text, 'findElement');
    } catch (err) {
      this.logger.error(
        { err, description, operation: 'findElement', latencyMs: Date.now() - t0 },
        'OpenAiProvider.findElement failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async findItems(query: ItemsQuery): Promise<ItemsResult> {
    const { description, pageContext, maxItems, order, existingSelectors } = query;
    const existingNote =
      existingSelectors && existingSelectors.length > 0
        ? `\nAlready found via pattern (fill the rest if needed): ${existingSelectors.join(', ')}`
        : '';

    const userMessage = `Description: ${description}
Order: ${order}
Max items: ${maxItems}${existingNote}

Page HTML (truncated):
${truncateHtml(pageContext.html)}`;

    const t0 = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.itemsFinder },
          { role: 'user', content: userMessage },
        ],
      });

      this.logCall('findItems', t0, response.usage, { description, maxItems, order });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<ItemsResult>(text, 'findItems');
    } catch (err) {
      this.logger.error(
        { err, description, operation: 'findItems', latencyMs: Date.now() - t0 },
        'OpenAiProvider.findItems failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async evaluateCondition(query: ConditionQuery): Promise<ConditionEvaluation> {
    const { question, pageContext } = query;

    const userMessage = `Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}

Question: ${question}`;

    const t0 = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.conditionEvaluator },
          { role: 'user', content: userMessage },
        ],
      });

      this.logCall('evaluateCondition', t0, response.usage, { question });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<ConditionEvaluation>(text, 'evaluateCondition');
    } catch (err) {
      this.logger.error(
        { err, question, operation: 'evaluateCondition', latencyMs: Date.now() - t0 },
        'OpenAiProvider.evaluateCondition failed',
      );
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

    const t0 = Date.now();
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

      this.logCall('decideAction', t0, response.usage, { stepDescription });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<ActionDecision>(text, 'decideAction');
    } catch (err) {
      this.logger.error(
        { err, stepDescription, operation: 'decideAction', latencyMs: Date.now() - t0 },
        'OpenAiProvider.decideAction failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async interpretPage(pageContext: PageContext, question: string): Promise<string> {
    const userMessage = `Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}

Question: ${question}`;

    const t0 = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.pageInterpreter },
          { role: 'user', content: userMessage },
        ],
      });

      this.logCall('interpretPage', t0, response.usage, { question });

      return response.choices[0]?.message?.content ?? '';
    } catch (err) {
      this.logger.error(
        { err, question, operation: 'interpretPage', latencyMs: Date.now() - t0 },
        'OpenAiProvider.interpretPage failed',
      );
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

    const t0 = Date.now();
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

      this.logCall('extractData', t0, response.usage);

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<unknown>(text, 'extractData');
    } catch (err) {
      this.logger.error(
        { err, operation: 'extractData', latencyMs: Date.now() - t0 },
        'OpenAiProvider.extractData failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
