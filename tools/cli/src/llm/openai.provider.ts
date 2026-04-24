import OpenAI from 'openai';
import pino from 'pino';
import type {
  ActionDecision,
  AgentPlan,
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
  PingResult,
  PlanQuery,
} from './provider.interface.js';
import { classifyPingError } from './ping-error.js';
import { SYSTEM_PROMPTS, buildToolsInventoryBlock } from './prompts.js';

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

  /**
   * Connectivity probe for OpenAI and OpenAI-compatible providers
   * (Kimi, Together, local Ollama behind the OpenAI shim, ...). Uses
   * `models.list()` which is a cheap authenticated GET that every
   * OpenAI-shape API supports. Never throws — all failures are
   * captured in the returned PingResult.
   */
  async ping(): Promise<PingResult> {
    const t0 = Date.now();
    try {
      await this.client.models.list();
      return {
        ok: true,
        providerName: this.name,
        model: this.model,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      this.logger.warn(
        { err, operation: 'ping', latencyMs: Date.now() - t0 },
        'OpenAiProvider.ping failed',
      );
      return classifyPingError({ providerName: this.name, model: this.model, err });
    }
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
        max_completion_tokens: 512,
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
        max_completion_tokens: 2048,
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

    const userText = `Page URL: ${pageContext.url}
Page title: ${pageContext.title}
HTML:
${truncateHtml(pageContext.html)}

Question: ${question}`;

    // When the caller passed a base64 screenshot (aiscope sets this via
    // its `includeScreenshot` flag), send it as an `image_url` data-URI
    // content block so questions about visual state can actually see
    // the pixels. Standard condition steps pass no screenshot and stay
    // text-only.
    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } };
    const content: ContentPart[] = [];
    if (pageContext.screenshot) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${pageContext.screenshot}` },
      });
    }
    content.push({ type: 'text', text: userText });

    const t0 = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.conditionEvaluator },
          // Cast: the SDK's union type is permissive but TypeScript
          // can't narrow it without a per-model type. Same pattern as
          // decideNextAction below.
          { role: 'user', content: content as unknown as string },
        ],
      });

      this.logCall('evaluateCondition', t0, response.usage, {
        question,
        withScreenshot: !!pageContext.screenshot,
      });

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
        max_completion_tokens: 512,
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
        max_completion_tokens: 1024,
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

  /**
   * Drive one iteration of an aiscope agent loop. Builds the prompt
   * body (goal + allowed actions + recent history + simplified HTML)
   * and when a base64 PNG screenshot is present, sends it as an
   * `image_url` content block using a data URI. Uses JSON-object
   * response format so the model returns strict JSON for the runner
   * to dispatch directly.
   */
  async decideNextAction(query: NextActionQuery): Promise<NextActionResult> {
    const {
      goal,
      pageContext,
      allowedActions,
      recentHistory,
      availableInputs,
      availableTools,
      selfTerminating,
      plan,
      currentMilestoneId,
    } = query;

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

    const agentModeBlock =
      plan && currentMilestoneId
        ? `\n## Agent mode — current plan\n\nPlan summary: ${plan.summary}\n\n${plan.milestones
            .map((m) => {
              const marker = m.id === currentMilestoneId ? '▶ CURRENT' : '  ';
              const done = m.doneWhen ? ` (done when: ${m.doneWhen})` : '';
              return `${marker} ${m.id} — ${m.description}${done}`;
            })
            .join(
              '\n',
            )}\n\nCurrent milestone: ${currentMilestoneId}. Pick actions that advance it. Add "milestoneComplete": true when this milestone is done so the runner advances. Add "replan": true only if the plan is materially wrong (not just a single failed action).`
        : '';

    const toolsInventoryBlock =
      availableTools && availableTools.length > 0
        ? '\n' + buildToolsInventoryBlock(availableTools)
        : '';

    const userText = `## Goal
${goal}

## Allowed actions
${allowedActions.join(', ')}

## Recent action history (oldest first)
${historyBlock}${availableInputsBlock}${selfTerminatingBlock}${agentModeBlock}${toolsInventoryBlock}
## Current page
URL: ${pageContext.url}
Title: ${pageContext.title}

HTML:
${truncateHtml(pageContext.html)}

Pick the single next action that best advances the goal. Return strict JSON only.`;

    // OpenAI chat content is an array of parts. Image parts come first.
    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } };
    const content: ContentPart[] = [];
    if (pageContext.screenshot) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${pageContext.screenshot}` },
      });
    }
    content.push({ type: 'text', text: userText });

    const t0 = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.aiScopeActionDecider },
          // The OpenAI SDK types accept multi-part user content when the
          // model supports vision. Cast here because the SDK's union
          // type is permissive but TypeScript can't narrow it without
          // a per-model type.
          { role: 'user', content: content as unknown as string },
        ],
      });

      this.logCall('decideNextAction', t0, response.usage, {
        goal,
        allowedActions: allowedActions.length,
        historySize: recentHistory.length,
        withScreenshot: !!pageContext.screenshot,
      });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<NextActionResult>(text, 'decideNextAction');
    } catch (err) {
      this.logger.error(
        { err, goal, operation: 'decideNextAction', latencyMs: Date.now() - t0 },
        'OpenAiProvider.decideNextAction failed',
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Produce an agent-mode plan. Parallel to the Anthropic implementation —
   * same user-message shape, same JSON response format. The LLM-agnostic
   * contract means swapping providers changes no plan-level semantics.
   */
  async decidePlan(query: PlanQuery): Promise<AgentPlan> {
    const { goal, pageContext, allowedActions, availableInputs, availableTools, previousPlan } =
      query;

    const availableInputsBlock =
      availableInputs && availableInputs.length > 0
        ? `\n## Available inputs\n${availableInputs.map((i) => `- ${i.name} (${i.type})${i.description ? ': ' + i.description : ''}`).join('\n')}`
        : '';

    const previousPlanBlock = previousPlan
      ? `\n## Previous plan (REPLAN requested)\n\nSummary: ${previousPlan.plan.summary}\n\nMilestones:\n${previousPlan.plan.milestones
          .map(
            (m) =>
              `- ${m.id}${previousPlan.attemptedMilestoneIds.includes(m.id) ? ' [attempted]' : ''} — ${m.description}`,
          )
          .join('\n')}\n\nReplan reason: ${previousPlan.reason}\n\nBuild a DIFFERENT plan that avoids whatever caused the replan. Do not repeat the attempted milestones verbatim.`
      : '';

    const toolsInventoryBlock =
      availableTools && availableTools.length > 0
        ? '\n' + buildToolsInventoryBlock(availableTools)
        : '';

    const userText = `## Goal
${goal}

## Allowed actions in executor vocabulary
${allowedActions.join(', ')}${availableInputsBlock}${previousPlanBlock}${toolsInventoryBlock}
## Current page
URL: ${pageContext.url}
Title: ${pageContext.title}

HTML:
${truncateHtml(pageContext.html)}

Produce a linear plan of 2-8 milestones for completing the goal. Return strict JSON only.`;

    type ContentPart =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } };
    const content: ContentPart[] = [];
    if (pageContext.screenshot) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${pageContext.screenshot}` },
      });
    }
    content.push({ type: 'text', text: userText });

    const t0 = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.agentPlanner },
          { role: 'user', content: content as unknown as string },
        ],
      });

      this.logCall('decidePlan', t0, response.usage, {
        goal,
        withScreenshot: !!pageContext.screenshot,
        isReplan: !!previousPlan,
      });

      const text = response.choices[0]?.message?.content ?? '';
      return parseJsonResponse<AgentPlan>(text, 'decidePlan');
    } catch (err) {
      this.logger.error(
        { err, goal, operation: 'decidePlan', latencyMs: Date.now() - t0 },
        'OpenAiProvider.decidePlan failed',
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
        max_completion_tokens: 2048,
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
