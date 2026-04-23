import Anthropic from '@anthropic-ai/sdk';
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
  NextActionQuery,
  NextActionResult,
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

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly logger: pino.Logger;

  constructor(config: LlmProviderConfig, logger?: pino.Logger) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
    this.logger = logger ?? pino({ level: 'silent' });
  }

  /**
   * Log a structured entry for an LLM call. Called from within each
   * operation once the SDK response is in hand so we can capture
   * latency AND token usage in a single log line.
   */
  private logCall(
    operation: string,
    startTs: number,
    usage: { input_tokens?: number; output_tokens?: number } | undefined,
    extra?: Record<string, unknown>,
  ): void {
    this.logger.debug(
      {
        provider: 'anthropic',
        model: this.model,
        operation,
        latencyMs: Date.now() - startTs,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
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
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: SYSTEM_PROMPTS.elementFinder,
        messages: [{ role: 'user', content: userMessage }],
      });

      this.logCall('findElement', t0, response.usage, {
        description,
        failedSelectorCount: failedSelectors?.length ?? 0,
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<ElementResult>(text, 'findElement');
    } catch (err) {
      this.logger.error(
        { err, description, operation: 'findElement', latencyMs: Date.now() - t0 },
        'AnthropicProvider.findElement failed',
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
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPTS.itemsFinder,
        messages: [{ role: 'user', content: userMessage }],
      });

      this.logCall('findItems', t0, response.usage, {
        description,
        maxItems,
        order,
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<ItemsResult>(text, 'findItems');
    } catch (err) {
      this.logger.error(
        { err, description, operation: 'findItems', latencyMs: Date.now() - t0 },
        'AnthropicProvider.findItems failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async evaluateCondition(query: ConditionQuery): Promise<ConditionEvaluation> {
    const { question, pageContext } = query;

    const userText = `Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}

Question: ${question}`;

    // When the caller passed a base64 screenshot (aiscope sets this via
    // its `includeScreenshot` flag), send it as an image content block
    // so questions about visual state ("is the cookie banner dismissed?")
    // can actually use the pixels instead of guessing from HTML alone.
    // Standard condition steps pass no screenshot and stay text-only.
    const content: Array<
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: { type: 'base64'; media_type: 'image/png'; data: string };
        }
    > = [];
    if (pageContext.screenshot) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: pageContext.screenshot,
        },
      });
    }
    content.push({ type: 'text', text: userText });

    const t0 = Date.now();
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPTS.conditionEvaluator,
        messages: [{ role: 'user', content }],
      });

      this.logCall('evaluateCondition', t0, response.usage, {
        question,
        withScreenshot: !!pageContext.screenshot,
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<ConditionEvaluation>(text, 'evaluateCondition');
    } catch (err) {
      this.logger.error(
        { err, question, operation: 'evaluateCondition', latencyMs: Date.now() - t0 },
        'AnthropicProvider.evaluateCondition failed',
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
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: SYSTEM_PROMPTS.actionDecider,
        messages: [{ role: 'user', content: userMessage }],
      });

      this.logCall('decideAction', t0, response.usage, { stepDescription });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<ActionDecision>(text, 'decideAction');
    } catch (err) {
      this.logger.error(
        { err, stepDescription, operation: 'decideAction', latencyMs: Date.now() - t0 },
        'AnthropicProvider.decideAction failed',
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
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPTS.pageInterpreter,
        messages: [{ role: 'user', content: userMessage }],
      });

      this.logCall('interpretPage', t0, response.usage, { question });

      return response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');
    } catch (err) {
      this.logger.error(
        { err, question, operation: 'interpretPage', latencyMs: Date.now() - t0 },
        'AnthropicProvider.interpretPage failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Drive one iteration of an aiscope agent loop. Builds a text prompt
   * describing the goal, allowed actions, and recent history, and
   * prepends a base64 PNG image block when the page context carries a
   * screenshot. Parses the model's JSON response into a NextActionResult.
   */
  async decideNextAction(query: NextActionQuery): Promise<NextActionResult> {
    const { goal, pageContext, allowedActions, recentHistory, availableInputs, selfTerminating } =
      query;

    const historyBlock =
      recentHistory.length > 0
        ? recentHistory
            .map((h) => {
              const head = `[#${h.iteration}] action=${h.action}`;
              const sel = h.selector ? ` selector="${h.selector}"` : '';
              const val = h.value ? ` value="${h.value}"` : '';
              const ref = h.inputRef ? ` inputRef="${h.inputRef}"` : '';
              const toolRes = h.toolResult ? ` toolResult="${h.toolResult}"` : '';
              const outcome = h.succeeded
                ? ' → succeeded'
                : ` → FAILED: ${h.error ?? '(no message)'}`;
              return `${head}${sel}${val}${ref}${toolRes}${outcome}`;
            })
            .join('\n')
        : '(no prior actions in this aiscope session)';

    // Build the available inputs table only when inputs are declared.
    // Values are NEVER included — only names and types so the LLM knows
    // what it can reference via inputRef.
    const availableInputsBlock =
      availableInputs && availableInputs.length > 0
        ? `\n## Available inputs\n\nThe following inputs are available for use with inputRef in type actions:\n\n| Name | Type | Description |\n|------|------|-------------|\n${availableInputs.map((i) => `| ${i.name} | ${i.type} | ${i.description ?? ''} |`).join('\n')}\n\nFor inputs marked "secret", ALWAYS use inputRef — never put the actual value in your response.`
        : '';

    const selfTerminatingBlock = selfTerminating
      ? '\n## Termination mode\n"selfTerminating": true — this run has NO user success check. Your "done" is authoritative and will end the loop immediately. Only emit "done" when you have direct on-page evidence that the goal is complete.'
      : '';

    const userText = `## Goal
${goal}

## Allowed actions
${allowedActions.join(', ')}

## Recent action history (oldest first)
${historyBlock}${availableInputsBlock}${selfTerminatingBlock}

## Current page
URL: ${pageContext.url}
Title: ${pageContext.title}

HTML:
${truncateHtml(pageContext.html)}

Pick the single next action that best advances the goal. Return strict JSON only.`;

    // Anthropic content shape: each user message's `content` is an array
    // of blocks. Image block comes first so the model reads it before
    // the text per Anthropic's vision recommendations.
    const content: Array<
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: { type: 'base64'; media_type: 'image/png'; data: string };
        }
    > = [];
    if (pageContext.screenshot) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: pageContext.screenshot,
        },
      });
    }
    content.push({ type: 'text', text: userText });

    const t0 = Date.now();
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPTS.aiScopeActionDecider,
        messages: [{ role: 'user', content }],
      });

      this.logCall('decideNextAction', t0, response.usage, {
        goal,
        allowedActions: allowedActions.length,
        historySize: recentHistory.length,
        withScreenshot: !!pageContext.screenshot,
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<NextActionResult>(text, 'decideNextAction');
    } catch (err) {
      this.logger.error(
        { err, goal, operation: 'decideNextAction', latencyMs: Date.now() - t0 },
        'AnthropicProvider.decideNextAction failed',
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
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPTS.dataExtractor,
        messages: [{ role: 'user', content: userMessage }],
      });

      this.logCall('extractData', t0, response.usage);

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      return parseJsonResponse<unknown>(text, 'extractData');
    } catch (err) {
      this.logger.error(
        { err, operation: 'extractData', latencyMs: Date.now() - t0 },
        'AnthropicProvider.extractData failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
