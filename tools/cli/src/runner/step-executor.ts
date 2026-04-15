import type {
  AiScopeAction,
  CallAction,
  ConditionAction,
  DownloadAction,
  ExtractAction,
  FunctionDefinition,
  GotoAction,
  InteractAction,
  LoopAction,
  LoopExitWhen,
  LoopItems,
  NavigateAction,
  Step,
  ToolCallAction,
  WaitAction,
} from '@portalflow/schema';
import type { PageService } from '../browser/page.service.js';
import type { ElementResolver } from '../browser/element-resolver.js';
import type { BrowserService } from '../browser/browser.service.js';
import type { PageContextCapture } from '../browser/context.js';
import type { LlmService } from '../llm/llm.service.js';
import type {
  AgentActionHistoryEntry,
  NextActionResult,
  PageContext,
} from '../llm/provider.interface.js';
import type { Tool } from '../tools/tool.interface.js';
import { RunContext } from './run-context.js';
import { RunPresenter } from './run-presenter.js';

/**
 * Default action whitelist for aiscope steps when `allowedActions` is
 * not explicitly set in the step's action block. Matches the vocabulary
 * documented in `aiScopeActionDecider` system prompt.
 */
const DEFAULT_AISCOPE_ACTIONS = [
  'navigate',
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'hover',
  'focus',
  'scroll',
  'wait',
  'done',
] as const;

/**
 * How many recent action entries to keep in the FIFO passed to the LLM
 * on every iteration. Bounds prompt growth and prevents the model from
 * getting stuck repeating a failing move.
 */
const AISCOPE_HISTORY_WINDOW = 5;

const RETRY_BASE_DELAY_MS = 1_000;
const MAX_CALL_DEPTH = 16;

/**
 * Result of `executeWithPolicy`. Extends the old boolean shape to carry
 * jump requests emitted by a condition step's `thenStep` / `elseStep`
 * or by a `goto` step's `targetStepId`. The top-level runner loop is
 * the only place that actually applies the jump; internal callers (loops
 * and function bodies) propagate a jump outward by re-throwing it as a
 * tagged error so the outcome can be honored at the top level.
 */
export type StepOutcome =
  | 'continue'
  | 'abort'
  | { kind: 'jump'; targetStepId: string };

/**
 * Tagged error used to propagate a jump outcome out of a nested executor
 * (a loop's substep runner or a function body). The top-level runner
 * loop catches this via executeWithPolicy's normal failure path when a
 * jump bubbles out of a block it cannot satisfy. Inside the top-level
 * loop the jump never becomes an error — executeWithPolicy returns the
 * `{kind:'jump'}` variant directly.
 */
export class JumpOutOfBlockError extends Error {
  constructor(public readonly targetStepId: string) {
    super(
      `Cannot jump to step "${targetStepId}" from inside a loop substep or function body. Jumps are only supported at the top level of the automation.`,
    );
    this.name = 'JumpOutOfBlockError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StepExecutor {
  private callDepth = 0;
  /**
   * Set by `executeCondition` (when a thenStep/elseStep fires) or by
   * `executeGoto` (unconditionally). Consumed and cleared by
   * `executeWithPolicy` at the top of the wrapper, so every step gets a
   * clean slate and a single jump request never bleeds into the next
   * step's outcome.
   */
  private pendingJump: string | null = null;

  constructor(
    private readonly pageService: PageService,
    private readonly elementResolver: ElementResolver,
    private readonly tools: Map<string, Tool>,
    private readonly context: RunContext,
    private readonly browserService: BrowserService,
    private readonly screenshotOnFailure: boolean,
    private readonly contextCapture: PageContextCapture,
    private readonly llmService: LlmService,
    private readonly functions: Map<string, FunctionDefinition> = new Map(),
    /**
     * Optional terminal presenter. When provided, the executor calls
     * its methods at key user-visible moments (aiscope decisions, tool
     * outputs, extract results) so the user sees a clean stream on
     * stdout. Tests and internal callers can omit it — the executor
     * falls back to a silent no-op that discards all calls.
     */
    private readonly presenter: RunPresenter = new RunPresenter(false, ''),
  ) {}

  /**
   * Executes a step with its retry/skip/abort policy.
   *
   * Returns a `StepOutcome`:
   *   - `'continue'` — step ran (or was skipped after failure); run the next step.
   *   - `'abort'`    — step failed with abort policy; stop the whole run.
   *   - `{kind:'jump', targetStepId}` — step requested a jump (goto / condition.thenStep / etc).
   *     The top-level runner loop applies the jump by resetting its instruction pointer.
   */
  async executeWithPolicy(step: Step): Promise<StepOutcome> {
    // Clear any stale pending jump from a prior step. The field is set
    // from inside `execute(step)` (by executeCondition / executeGoto) and
    // consumed here at the end of the wrapper.
    this.pendingJump = null;

    const policy = step.onFailure;
    const maxRetries = step.maxRetries;
    let attempts = 0;

    while (true) {
      const attemptNumber = attempts + 1;
      const attemptStart = Date.now();
      try {
        await this.execute(step);
        this.context.logger.info(
          {
            stepId: step.id,
            stepName: step.name,
            type: step.type,
            attempt: attemptNumber,
            durationMs: Date.now() - attemptStart,
          },
          'step complete',
        );
        this.context.recordStepOutcome(step.id, 'success');
        // If the step set a pending jump (condition.thenStep or goto),
        // honor it here instead of returning plain 'continue'.
        if (this.pendingJump !== null) {
          const target = this.pendingJump;
          this.pendingJump = null;
          return { kind: 'jump', targetStepId: target };
        }
        return 'continue';
      } catch (err) {
        const durationMs = Date.now() - attemptStart;
        const message = err instanceof Error ? err.message : String(err);
        attempts += 1;

        if (policy === 'retry' && attempts <= maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempts - 1);
          this.context.logger.warn(
            {
              stepId: step.id,
              stepName: step.name,
              type: step.type,
              attempt: attempts,
              maxRetries,
              durationMs,
              delayMs: delay,
              err,
            },
            `Step failed (attempt ${attempts}/${maxRetries}), retrying after ${delay}ms: ${message}`,
          );
          await sleep(delay);
          continue;
        }

        // Record the error
        this.context.addError(step.id, step.name, message);

        if (policy === 'skip') {
          this.context.logger.warn(
            {
              stepId: step.id,
              stepName: step.name,
              type: step.type,
              policy: 'skip',
              durationMs,
              err,
            },
            `Step failed and will be skipped: ${message}`,
          );
          this.context.recordStepOutcome(step.id, 'skipped', message);
          // If the failed step had already set a pending jump before
          // throwing (unusual but possible for composite handlers),
          // honor it even on the skip path. Clear otherwise.
          if (this.pendingJump !== null) {
            const target = this.pendingJump;
            this.pendingJump = null;
            return { kind: 'jump', targetStepId: target };
          }
          return 'continue';
        }

        // abort (or retry exhausted)
        this.context.logger.error(
          {
            stepId: step.id,
            stepName: step.name,
            type: step.type,
            policy,
            durationMs,
            err,
          },
          `Step failed — aborting run: ${message}`,
        );

        if (this.screenshotOnFailure) {
          try {
            const screenshotPath = await this.browserService.screenshot(`failure_${step.id}`);
            this.context.addArtifact(screenshotPath);
            this.context.logger.info(
              { stepId: step.id, screenshotPath },
              'Failure screenshot captured',
            );
          } catch (screenshotErr) {
            this.context.logger.warn(
              { stepId: step.id, err: screenshotErr },
              'Failed to capture failure screenshot',
            );
          }
        }

        this.context.recordStepOutcome(step.id, 'failed', message);
        this.pendingJump = null;
        return 'abort';
      }
    }
  }

  async execute(step: Step): Promise<void> {
    this.context.logger.debug(
      { stepId: step.id, stepName: step.name, type: step.type },
      'step start',
    );
    const runBody = async (): Promise<void> => {
      switch (step.type) {
        case 'navigate':
          await this.executeNavigate(step);
          break;
        case 'interact':
          await this.executeInteract(step);
          break;
        case 'wait':
          await this.executeWait(step);
          break;
        case 'extract':
          await this.executeExtract(step);
          break;
        case 'tool_call':
          await this.executeToolCall(step);
          break;
        case 'condition':
          await this.executeCondition(step);
          break;
        case 'download':
          await this.executeDownload(step);
          break;
        case 'loop':
          await this.executeLoop(step);
          break;
        case 'call':
          await this.executeCall(step);
          break;
        case 'goto':
          await this.executeGoto(step);
          break;
        case 'aiscope':
          await this.executeAiScope(step);
          break;
        default: {
          const exhaustive: never = step.type;
          throw new Error(`Unknown step type: ${String(exhaustive)}`);
        }
      }

      await this.validateStep(step);
    };

    await this.runWithStepTimeout(step, runBody);
  }

  /**
   * Enforce `step.timeout` as a hard ceiling by racing the step body
   * against a timer. Composite step types that carry their own internal
   * budgets (`loop` via its iteration cap, `call` via the nested child
   * steps' own timeouts, `aiscope` via `maxDurationSec`/`maxIterations`)
   * are exempt — wrapping them here would silently cap them at the
   * schema default of 30 seconds regardless of their declared budgets.
   *
   * The race cannot cancel the inner operation if the timer fires first;
   * the underlying promise keeps running until it settles. That's
   * acceptable because a step timeout is a hard failure — the run
   * aborts (or retries / skips per `onFailure`) and the browser is
   * reset / closed shortly after. The wrapper's job is to surface a
   * clear error instead of letting the run hang forever.
   */
  private async runWithStepTimeout(step: Step, fn: () => Promise<void>): Promise<void> {
    const EXEMPT: ReadonlyArray<Step['type']> = ['loop', 'call', 'aiscope'];
    if (EXEMPT.includes(step.type) || !step.timeout || step.timeout <= 0) {
      await fn();
      return;
    }

    const timeoutMs = step.timeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `Step "${step.id}" (${step.type}) exceeded step timeout of ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });

    try {
      await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private async executeLoop(step: Step): Promise<void> {
    const action = step.action as LoopAction;
    const substeps: Step[] = step.substeps ?? [];

    if (substeps.length === 0) {
      this.context.logger.warn({ stepId: step.id }, 'loop has no substeps; skipping');
      return;
    }

    const maxIterations = this.resolveMaxIterations(action.maxIterations);

    const items = action.items
      ? await this.discoverItems(action.items, maxIterations)
      : null;

    const iterationCap = items ? Math.min(maxIterations, items.length) : maxIterations;

    this.context.logger.info(
      { stepId: step.id, maxIterations, iterationCap, hasItems: items !== null },
      'loop start',
    );

    const indexVar = action.indexVar ?? 'loop_index';

    for (let i = 0; i < iterationCap; i++) {
      if (action.exitWhen && (await this.evaluateExitCondition(action.exitWhen))) {
        this.context.logger.info({ stepId: step.id, iteration: i }, 'loop exit condition met');
        break;
      }

      this.context.setVariable(indexVar, String(i));
      if (items && action.items) {
        const currentItem = items[i];
        if (currentItem !== undefined) {
          this.context.setVariable(action.items.itemVar, currentItem);
        }
      }

      this.context.logger.info({ stepId: step.id, iteration: i }, 'loop iteration start');

      let substepAborted = false;
      for (const substep of substeps) {
        const outcome = await this.executeWithPolicy(substep);
        if (outcome === 'abort') {
          substepAborted = true;
          break;
        }
        if (typeof outcome === 'object' && outcome.kind === 'jump') {
          // Jumps are not valid from inside a loop substep — the loop's
          // iteration state would be lost. Surface the attempt as a hard
          // failure of the iteration so the enclosing loop step respects
          // its own onFailure policy (retry / skip / abort).
          throw new JumpOutOfBlockError(outcome.targetStepId);
        }
        this.context.incrementCompleted();
      }

      if (substepAborted) {
        throw new Error(`Substep aborted in iteration ${i} of loop ${step.id}`);
      }

      this.context.logger.info({ stepId: step.id, iteration: i }, 'loop iteration complete');
    }

    this.context.logger.info({ stepId: step.id }, 'loop complete');
  }

  private resolveMaxIterations(raw: number | string): number {
    if (typeof raw === 'number') return raw;
    const resolved = this.context.resolveTemplate(raw);
    const parsed = parseInt(resolved, 10);
    if (isNaN(parsed) || parsed < 1) {
      throw new Error(`loop maxIterations resolved to invalid value: "${resolved}"`);
    }
    return parsed;
  }

  private async discoverItems(itemsConfig: LoopItems, maxItems: number): Promise<string[]> {
    const page = this.browserService.getPage();

    if (itemsConfig.selectorPattern) {
      try {
        const handles = await page.$$(itemsConfig.selectorPattern);
        if (handles.length >= maxItems) {
          const selectors = Array.from({ length: Math.min(handles.length, maxItems) }, (_, idx) =>
            `${itemsConfig.selectorPattern}:nth-of-type(${idx + 1})`,
          );
          this.context.logger.info(
            { pattern: itemsConfig.selectorPattern, count: selectors.length },
            'loop items discovered via deterministic pattern',
          );
          return selectors;
        }
      } catch (err) {
        this.context.logger.warn(
          { pattern: itemsConfig.selectorPattern, err: String(err) },
          'deterministic pattern failed, falling back to LLM',
        );
      }
    }

    const pageContext = await this.contextCapture.capture();
    const result = await this.llmService.findItems({
      description: itemsConfig.description,
      pageContext,
      maxItems,
      order: itemsConfig.order,
      existingSelectors: itemsConfig.selectorPattern
        ? [itemsConfig.selectorPattern]
        : undefined,
    });

    this.context.logger.info(
      { count: result.items.length, source: 'llm' },
      'loop items discovered via LLM',
    );

    const validated: string[] = [];
    for (const item of result.items) {
      try {
        const exists = await page.$(item.selector);
        if (exists) validated.push(item.selector);
      } catch {
        // skip invalid selectors
      }
    }

    return validated.slice(0, maxItems);
  }

  private async evaluateExitCondition(cond: LoopExitWhen): Promise<boolean> {
    return this.runDeterministicCheck(cond.check, cond.value);
  }

  /**
   * Evaluate a deterministic page check against the current run context.
   * Shared between the loop's `exitWhen`, the condition step's `check`,
   * and the aiscope step's `successCheck`. Template resolution happens
   * inside so every caller gets consistent behavior.
   *
   * Supports the full superset of checks across all callers:
   *   - element_exists  — CSS selector matches at least one DOM element
   *   - element_missing — CSS selector matches zero DOM elements
   *   - url_matches     — `value` is a substring of the current page URL
   *   - text_contains   — `value` is a substring of the rendered HTML
   *   - variable_equals — context variable `name=expected` matches
   *
   * The condition step's schema only allows the first, third, fourth,
   * and fifth (not `element_missing`); the loop allows all five; aiscope
   * follows the condition-step shape. The helper itself is permissive
   * and returns a boolean for any of the five without errors — unknown
   * check names throw.
   */
  private async runDeterministicCheck(
    check: 'element_exists' | 'element_missing' | 'url_matches' | 'text_contains' | 'variable_equals',
    rawValue: string,
  ): Promise<boolean> {
    const value = this.context.resolveTemplate(rawValue);
    switch (check) {
      case 'element_exists':
        return this.pageService.elementExists(value);
      case 'element_missing':
        return !(await this.pageService.elementExists(value));
      case 'url_matches':
        return (await this.pageService.getUrl()).includes(value);
      case 'text_contains':
        return (await this.pageService.getHtml()).includes(value);
      case 'variable_equals': {
        const eqIdx = value.indexOf('=');
        if (eqIdx === -1) return false;
        const varName = value.slice(0, eqIdx).trim();
        const expected = value.slice(eqIdx + 1).trim();
        return this.context.getVariable(varName) === expected;
      }
      default: {
        const exhaustive: never = check;
        throw new Error(`Unknown deterministic check: ${String(exhaustive)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Navigate
  // ---------------------------------------------------------------------------

  private async executeNavigate(step: Step): Promise<void> {
    const action = step.action as NavigateAction;
    const url = this.context.resolveTemplate(action.url);
    if (url !== action.url) {
      this.context.logger.debug(
        { stepId: step.id, rawUrl: action.url, resolvedUrl: url },
        'navigate template resolved',
      );
    }
    this.context.logger.debug({ stepId: step.id, url }, 'Navigating to URL');
    const t0 = Date.now();
    await this.pageService.navigate(url);
    this.context.logger.debug(
      { stepId: step.id, url, durationMs: Date.now() - t0 },
      'navigate complete',
    );
  }

  // ---------------------------------------------------------------------------
  // Interact
  // ---------------------------------------------------------------------------

  private async executeInteract(step: Step): Promise<void> {
    const action = step.action as InteractAction;

    // Resolve template variables in selectors before element resolution
    const resolvedPrimary = step.selectors?.primary
      ? this.context.resolveTemplate(step.selectors.primary)
      : undefined;
    const resolvedFallbacks = step.selectors?.fallbacks?.map((f) =>
      this.context.resolveTemplate(f),
    );

    // Resolve the selector via primary / fallback / AI
    const resolveStart = Date.now();
    const resolved = await this.elementResolver.resolve(
      resolvedPrimary,
      resolvedFallbacks,
      step.aiGuidance,
      step.description ?? step.name,
    );

    const selector = resolved.selector;
    this.context.logger.debug(
      {
        stepId: step.id,
        selector,
        source: resolved.source,
        interaction: action.interaction,
        resolveDurationMs: Date.now() - resolveStart,
      },
      'Resolved element for interaction',
    );

    switch (action.interaction) {
      case 'click':
        await this.pageService.click(selector);
        break;

      case 'type': {
        // Prefer inputRef (variable lookup) over literal value
        let text: string;
        let source: 'inputRef' | 'template' | 'empty' = 'empty';
        if (action.inputRef) {
          const varValue = this.context.getVariable(action.inputRef);
          if (varValue === undefined) {
            throw new Error(
              `Step "${step.id}": inputRef "${action.inputRef}" is not set in context variables.`,
            );
          }
          text = varValue;
          source = 'inputRef';
        } else if (action.value !== undefined) {
          text = this.context.resolveTemplate(action.value);
          source = 'template';
        } else {
          text = '';
        }
        this.context.logger.debug(
          {
            stepId: step.id,
            selector,
            source,
            inputRef: action.inputRef ?? null,
            textLength: text.length,
          },
          'type action resolved',
        );
        await this.pageService.type(selector, text);
        break;
      }

      case 'select': {
        const rawValue = action.value !== undefined ? action.value : '';
        const value = this.context.resolveTemplate(rawValue);
        if (value !== rawValue) {
          this.context.logger.debug(
            { stepId: step.id, selector, rawValue, resolvedValue: value },
            'select template resolved',
          );
        }
        await this.pageService.selectOption(selector, value);
        break;
      }

      case 'check':
        await this.pageService.check(selector);
        break;

      case 'uncheck':
        await this.pageService.uncheck(selector);
        break;

      case 'hover':
        await this.pageService.hover(selector);
        break;

      case 'focus':
        await this.pageService.focus(selector);
        break;

      default: {
        const exhaustive: never = action.interaction;
        throw new Error(`Unknown interaction type: ${String(exhaustive)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Wait
  // ---------------------------------------------------------------------------

  private async executeWait(step: Step): Promise<void> {
    const action = step.action as WaitAction;

    // Effective timeout: prefer the action-level override, then the
    // step-level `timeout` field (schema default 30000), then let
    // PageService fall back to its own internal default. This is what
    // the user intuitively expects when they write
    // `"timeout": 60000` on a wait step without repeating it inside
    // `action.timeout`.
    const effectiveTimeout = action.timeout ?? step.timeout;

    switch (action.condition) {
      case 'selector': {
        const rawSelector = action.value ?? '';
        if (!rawSelector) {
          throw new Error(`Step "${step.id}": wait with condition "selector" requires a value.`);
        }
        const selector = this.context.resolveTemplate(rawSelector);
        await this.pageService.waitForSelector(selector, effectiveTimeout);
        break;
      }

      case 'navigation':
        await this.pageService.waitForNavigation(action.value, effectiveTimeout);
        break;

      case 'delay': {
        const ms = action.value ? parseInt(action.value, 10) : 1000;
        if (isNaN(ms) || ms < 0) {
          throw new Error(
            `Step "${step.id}": wait with condition "delay" requires a numeric value in milliseconds.`,
          );
        }
        await this.pageService.delay(ms);
        break;
      }

      case 'network_idle':
        await this.pageService.waitForNetworkIdle(effectiveTimeout);
        break;

      default: {
        const exhaustive: never = action.condition;
        throw new Error(`Unknown wait condition: ${String(exhaustive)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Extract
  // ---------------------------------------------------------------------------

  private async executeExtract(step: Step): Promise<void> {
    const action = step.action as ExtractAction;
    let value: unknown;

    // Selectors are optional for page-level targets (url, title, html)
    const selector = step.selectors?.primary;

    switch (action.target) {
      case 'text': {
        if (!selector) {
          throw new Error(`Step "${step.id}": extract "text" requires a selector.`);
        }
        value = await this.pageService.getText(selector);
        break;
      }

      case 'attribute': {
        if (!selector) {
          throw new Error(`Step "${step.id}": extract "attribute" requires a selector.`);
        }
        if (!action.attribute) {
          throw new Error(`Step "${step.id}": extract "attribute" requires the "attribute" field.`);
        }
        value = await this.pageService.getAttribute(selector, action.attribute);
        break;
      }

      case 'html':
        value = await this.pageService.getHtml(selector);
        break;

      case 'url':
        value = await this.pageService.getUrl();
        break;

      case 'title':
        value = await this.pageService.getTitle();
        break;

      case 'screenshot': {
        // Screenshot is treated as an artifact; store path in outputs too
        const screenshotPath = await this.pageService.getUrl(); // capture name from URL if needed
        // We capture the screenshot ourselves and record it
        this.context.logger.debug({ stepId: step.id }, 'Screenshot extract — captured via page context');
        // For screenshot extraction we store a marker; actual screenshot
        // capture happens via BrowserService in the runner when needed.
        value = `[screenshot:${action.outputName}]`;
        break;
      }

      default: {
        const exhaustive: never = action.target;
        throw new Error(`Unknown extract target: ${String(exhaustive)}`);
      }
    }

    this.context.addOutput(action.outputName, value);

    // Also expose as a context variable for template resolution in later steps
    if (typeof value === 'string') {
      this.context.setVariable(action.outputName, value);
    }

    // Surface the extracted value in the terminal view (presenter no-op
    // in verbose mode).
    this.presenter.extractResult(action.outputName, value);

    // At debug level, log the actual extracted value (capped) so troubleshooters
    // can see *what* was captured — not just that an extract happened. Large
    // HTML payloads are truncated to keep log files readable.
    const PREVIEW_CAP = 500;
    let preview: unknown = value;
    let truncated = false;
    if (typeof value === 'string' && value.length > PREVIEW_CAP) {
      preview = value.slice(0, PREVIEW_CAP);
      truncated = true;
    }
    this.context.logger.debug(
      {
        stepId: step.id,
        outputName: action.outputName,
        target: action.target,
        valuePreview: preview,
        valueLength: typeof value === 'string' ? value.length : null,
        truncated,
      },
      'Extracted value stored in outputs',
    );
  }

  // ---------------------------------------------------------------------------
  // Tool call
  // ---------------------------------------------------------------------------

  private async executeToolCall(step: Step): Promise<void> {
    const action = step.action as ToolCallAction;
    const tool = this.tools.get(action.tool);

    if (!tool) {
      throw new Error(
        `Step "${step.id}": tool "${action.tool}" is not registered. Available tools: ${[...this.tools.keys()].join(', ') || '(none)'}.`,
      );
    }

    // Resolve template variables in tool call arguments
    const resolvedArgs = action.args
      ? Object.fromEntries(
          Object.entries(action.args).map(([k, v]) => [k, this.context.resolveTemplate(v)]),
        )
      : {};

    this.context.logger.debug(
      {
        stepId: step.id,
        tool: action.tool,
        command: action.command,
        rawArgs: action.args ?? {},
        resolvedArgs,
      },
      'Executing tool call',
    );

    this.presenter.toolCallStart(action.tool, action.command);

    const t0 = Date.now();
    const result = await tool.execute(action.command, resolvedArgs);
    const durationMs = Date.now() - t0;

    this.context.logger.debug(
      {
        stepId: step.id,
        tool: action.tool,
        command: action.command,
        success: result.success,
        durationMs,
        hasFields: !!result.fields,
        outputLength: result.output?.length ?? 0,
      },
      'Tool call returned',
    );

    if (!result.success) {
      throw new Error(
        `Step "${step.id}": tool "${action.tool}" command "${action.command}" failed: ${result.error ?? 'unknown error'}`,
      );
    }

    if (action.outputName) {
      this.context.addOutput(action.outputName, result.output);
      this.context.setVariable(action.outputName, result.output);
      if (result.fields) {
        for (const [k, v] of Object.entries(result.fields)) {
          this.context.setVariable(`${action.outputName}_${k}`, v);
        }
        this.context.logger.debug(
          {
            stepId: step.id,
            outputName: action.outputName,
            explodedFields: Object.keys(result.fields),
          },
          'Tool returned multi-field result; exploded into context variables',
        );
      }
      this.context.logger.debug(
        { stepId: step.id, outputName: action.outputName },
        'Tool output stored in context',
      );
      this.presenter.toolCallResult(action.outputName, result.output);
    }
  }

  // ---------------------------------------------------------------------------
  // Call — invoke a named function from the automation's `functions` section
  // ---------------------------------------------------------------------------

  private async executeCall(step: Step): Promise<void> {
    const action = step.action as CallAction;
    const fnName = this.context.resolveTemplate(action.function);
    await this.invokeFunction(fnName, action.args ?? {}, step.id);
  }

  // ---------------------------------------------------------------------------
  // Goto — request an unconditional jump to a named top-level step
  // ---------------------------------------------------------------------------
  //
  // Sets `pendingJump` on the executor. `executeWithPolicy` reads and clears
  // the field after this step returns and surfaces the jump as a
  // `{kind:'jump', targetStepId}` outcome. The top-level runner loop applies
  // the jump by resetting its instruction pointer. `targetStepId` supports
  // template resolution so the jump target can be variable-driven.

  private async executeGoto(step: Step): Promise<void> {
    const action = step.action as GotoAction;
    const target = this.context.resolveTemplate(action.targetStepId).trim();
    if (target.length === 0) {
      throw new Error(
        `Step "${step.id}": goto action has an empty targetStepId (resolved from "${action.targetStepId}").`,
      );
    }
    this.pendingJump = target;
    this.context.logger.debug(
      { stepId: step.id, targetStepId: target },
      'goto step set pending jump',
    );
  }

  // ---------------------------------------------------------------------------
  // AiScope — hand control to an LLM for a bounded goal-driven sub-run
  // ---------------------------------------------------------------------------
  //
  // The loop shape on every iteration:
  //
  //   1. Check both budget caps (wall-clock AND iteration count). Either
  //      one exceeded throws an error with a clear message naming the cap.
  //   2. Capture the current page context (simplified HTML + optional
  //      viewport screenshot).
  //   3. Evaluate the user's successCheck against the current context.
  //      If it passes, we're done.
  //   4. Ask the LLM (via decideNextAction) what to do next. The query
  //      carries the goal, the page context, the allowed action list,
  //      and a short history of recent attempts.
  //   5. Dispatch the chosen action through PageService. If the action
  //      throws, the error is logged + captured in the history buffer
  //      so the LLM can correct on the next iteration — the loop does
  //      NOT abort on a single failed action.
  //   6. Append to the recent-history FIFO (capped at AISCOPE_HISTORY_WINDOW).
  //
  // The loop exits under three conditions:
  //   - successCheck passes → step succeeds normally.
  //   - Budget exhausted (wall-clock OR iterations) → throw with clear error.
  //     The step's own onFailure policy then decides retry/skip/abort.
  //   - The LLM emits "done" AND the successCheck agrees on the next
  //     iteration → step succeeds. If the check disagrees, the loop keeps
  //     going until the budget is exhausted (the LLM can't lie its way out).

  private async executeAiScope(step: Step): Promise<void> {
    const action = step.action as AiScopeAction;

    // Defensive guard. The schema's discriminated union should make it
    // impossible for an aiscope step to reach here without a goal
    // (the parser rejects malformed aiscope actions with a targeted
    // error message), but a clear runtime error beats
    // "Cannot read properties of undefined" if a future schema
    // regression or a direct-from-JS caller sneaks through.
    if (typeof action.goal !== 'string' || action.goal.trim().length === 0) {
      throw new Error(
        `aiscope step "${step.id}" has no "goal" — an aiscope action requires a non-empty "goal" string describing what the LLM should accomplish.`,
      );
    }
    if (!action.successCheck) {
      throw new Error(
        `aiscope step "${step.id}" has no "successCheck" — an aiscope action requires a "successCheck" with either {check, value} or {ai}.`,
      );
    }

    const startedAt = Date.now();
    const deadlineMs = startedAt + action.maxDurationSec * 1000;
    const history: AgentActionHistoryEntry[] = [];
    const logger = this.context.logger;
    const allowedActions =
      action.allowedActions ?? (DEFAULT_AISCOPE_ACTIONS as readonly string[] as string[]);

    // Resolve `${var}` references in the goal once up front. Every other
    // user-editable string the runner touches (navigate.url, type values,
    // condition.ai questions, etc.) passes through resolveTemplate; the
    // aiscope goal is no different and is especially useful when an
    // aiscope step lives inside a loop body that wants to reference
    // `${loop_index}` or the item variable in the goal text.
    const resolvedGoal = this.context.resolveTemplate(action.goal);

    logger.info(
      {
        stepId: step.id,
        goal: resolvedGoal,
        maxDurationSec: action.maxDurationSec,
        maxIterations: action.maxIterations,
        includeScreenshot: action.includeScreenshot,
        allowedActions,
      },
      'aiscope: start',
    );

    this.presenter.aiscopeStart(step.id, action.maxIterations);

    for (let iteration = 1; iteration <= action.maxIterations; iteration++) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          `aiscope step "${step.id}" exceeded wall-clock budget of ${action.maxDurationSec}s after ${iteration - 1} iteration(s) (goal: ${resolvedGoal}).`,
        );
      }

      logger.info(
        {
          stepId: step.id,
          iteration,
          maxIterations: action.maxIterations,
          remainingMs,
        },
        'aiscope: iteration start',
      );

      this.presenter.aiscopeIteration(iteration);

      // 1. Observe
      const pageContext = await this.contextCapture.capture({
        includeScreenshot: action.includeScreenshot,
      });

      // 2. Success check
      if (await this.evaluateSuccessCheck(action.successCheck, pageContext)) {
        const durationMs = Date.now() - startedAt;
        logger.info(
          {
            stepId: step.id,
            iteration,
            durationMs,
          },
          'aiscope: goal achieved',
        );
        this.presenter.aiscopeGoalReached(durationMs, iteration - 1);
        return;
      }

      // 3. Ask the LLM for the next action
      const decision = await this.llmService.decideNextAction({
        goal: resolvedGoal,
        pageContext,
        allowedActions,
        recentHistory: history.slice(-AISCOPE_HISTORY_WINDOW),
      });

      logger.info(
        {
          stepId: step.id,
          iteration,
          action: decision.action,
          selector: decision.selector ?? null,
          value: decision.value ?? null,
          reasoning: decision.reasoning,
        },
        'aiscope: decided',
      );

      this.presenter.aiscopeDecision(
        decision.action,
        decision.selector,
        decision.reasoning ?? '',
      );

      // 4. Dispatch — validate against the allowed list FIRST so that a
      // user who explicitly excludes `done` from `allowedActions` actually
      // gets the exclusion they asked for. The default list does include
      // `done`, so the usual behavior (loop re-verifies success check on
      // the next iteration) is unchanged.
      if (!allowedActions.includes(decision.action)) {
        logger.warn(
          {
            stepId: step.id,
            iteration,
            action: decision.action,
            allowedActions,
          },
          'aiscope: LLM emitted an action outside the allowed list — ignoring',
        );
        history.push({
          iteration,
          action: decision.action,
          succeeded: false,
          error: `action "${decision.action}" is not in the allowed list: ${allowedActions.join(', ')}`,
        });
        continue;
      }

      if (decision.action === 'done') {
        // Treat as a hint — the top of the next iteration re-runs the
        // success check. If the model was wrong we keep trying.
        history.push({
          iteration,
          action: 'done',
          succeeded: true,
        });
        continue;
      }

      try {
        await this.dispatchAiScopeAction(decision);
        history.push({
          iteration,
          action: decision.action,
          selector: decision.selector,
          value: decision.value,
          succeeded: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          {
            stepId: step.id,
            iteration,
            action: decision.action,
            selector: decision.selector ?? null,
            err,
          },
          'aiscope: action dispatch failed — feeding error back to LLM on next iteration',
        );
        history.push({
          iteration,
          action: decision.action,
          selector: decision.selector,
          value: decision.value,
          succeeded: false,
          error: message,
        });
      }
    }

    throw new Error(
      `aiscope step "${step.id}" exhausted the ${action.maxIterations}-iteration budget without reaching the goal "${resolvedGoal}". Consider increasing maxIterations, giving a clearer goal, or replacing with explicit steps.`,
    );
  }

  /**
   * Dispatch a single LLM-chosen action through PageService. Bad
   * selectors, missing values, and Playwright errors all throw — the
   * caller (`executeAiScope`) catches these, logs them, and feeds the
   * error back to the LLM on the next iteration so it can adapt.
   */
  private async dispatchAiScopeAction(decision: NextActionResult): Promise<void> {
    const { action, selector, value } = decision;
    switch (action) {
      case 'navigate':
        if (!value) throw new Error('navigate requires a URL in `value`');
        await this.pageService.navigate(value);
        return;
      case 'click':
        if (!selector) throw new Error('click requires a `selector`');
        await this.pageService.click(selector);
        return;
      case 'type':
        if (!selector || value === undefined) {
          throw new Error('type requires `selector` and `value`');
        }
        await this.pageService.type(selector, value);
        return;
      case 'select':
        if (!selector || value === undefined) {
          throw new Error('select requires `selector` and `value`');
        }
        await this.pageService.selectOption(selector, value);
        return;
      case 'check':
        if (!selector) throw new Error('check requires a `selector`');
        await this.pageService.check(selector);
        return;
      case 'uncheck':
        if (!selector) throw new Error('uncheck requires a `selector`');
        await this.pageService.uncheck(selector);
        return;
      case 'hover':
        if (!selector) throw new Error('hover requires a `selector`');
        await this.pageService.hover(selector);
        return;
      case 'focus':
        if (!selector) throw new Error('focus requires a `selector`');
        await this.pageService.focus(selector);
        return;
      case 'scroll': {
        const direction = (value ?? 'down') as 'up' | 'down' | 'top' | 'bottom';
        if (!['up', 'down', 'top', 'bottom'].includes(direction)) {
          throw new Error(
            `scroll value must be "up", "down", "top", or "bottom" — got "${direction}"`,
          );
        }
        await this.pageService.scroll(direction);
        return;
      }
      case 'wait': {
        const ms = value ? parseInt(value, 10) : 1000;
        if (isNaN(ms) || ms < 0) {
          throw new Error(
            `wait value must be a non-negative number of milliseconds — got "${value}"`,
          );
        }
        await this.pageService.delay(ms);
        return;
      }
      default:
        throw new Error(`aiscope: unknown action "${action}"`);
    }
  }

  /**
   * Evaluate the aiscope successCheck against the current page context.
   * Deterministic checks go through `runDeterministicCheck`; AI checks
   * go through the existing `llmService.evaluateCondition` path used by
   * the condition step's `ai:` branch. Schema validation already
   * enforces that exactly one form is set.
   */
  private async evaluateSuccessCheck(
    sc: AiScopeAction['successCheck'],
    pageContext: PageContext,
  ): Promise<boolean> {
    if (sc.check !== undefined && sc.value !== undefined) {
      return this.runDeterministicCheck(
        sc.check as 'element_exists' | 'url_matches' | 'text_contains' | 'variable_equals',
        sc.value,
      );
    }
    if (sc.ai !== undefined) {
      const evaluation = await this.llmService.evaluateCondition({
        question: this.context.resolveTemplate(sc.ai),
        pageContext,
      });
      return evaluation.result;
    }
    return false;
  }

  /**
   * Shared entry point used by executeCall AND by executeCondition's
   * thenCall/elseCall. Resolves args through templating, shadows the
   * function's declared parameter names on the shared context, runs each
   * step in the function body through executeWithPolicy, then restores
   * the previous variable values — regardless of success or failure.
   */
  async invokeFunction(
    name: string,
    rawArgs: Record<string, string>,
    callerStepId: string,
  ): Promise<void> {
    if (this.callDepth >= MAX_CALL_DEPTH) {
      throw new Error(
        `Function call depth limit (${MAX_CALL_DEPTH}) exceeded while calling "${name}" from step "${callerStepId}"`,
      );
    }

    const fn = this.functions.get(name);
    if (!fn) {
      throw new Error(
        `Unknown function "${name}" invoked from step "${callerStepId}"`,
      );
    }

    // 1. Resolve & validate args against declared parameters.
    const resolvedArgs: Record<string, string> = {};
    for (const param of fn.parameters ?? []) {
      let raw = rawArgs[param.name];
      if (raw === undefined) {
        if (param.default !== undefined) {
          raw = param.default;
        } else if (param.required) {
          throw new Error(
            `Function "${name}" missing required parameter "${param.name}" (called from "${callerStepId}")`,
          );
        }
      }
      if (raw !== undefined) {
        resolvedArgs[param.name] = this.context.resolveTemplate(raw);
      }
    }

    // Warn on extra args not declared by the function — usually a typo.
    const declared = new Set((fn.parameters ?? []).map((p) => p.name));
    for (const key of Object.keys(rawArgs)) {
      if (!declared.has(key)) {
        this.context.logger.warn(
          { function: name, unknownArg: key },
          `Function "${name}" received arg "${key}" which is not declared as a parameter`,
        );
      }
    }

    // 2. Save-and-restore previous values for shadowed parameter names.
    const savedVars = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(resolvedArgs)) {
      savedVars.set(k, this.context.getVariable(k));
      this.context.setVariable(k, v);
    }

    this.callDepth += 1;
    this.context.logger.info(
      { function: name, depth: this.callDepth, args: resolvedArgs, callerStepId },
      `Function "${name}" invoked`,
    );

    try {
      for (const innerStep of fn.steps) {
        const outcome = await this.executeWithPolicy(innerStep);
        if (outcome === 'abort') {
          throw new Error(`Function "${name}" aborted at step "${innerStep.id}"`);
        }
        if (typeof outcome === 'object' && outcome.kind === 'jump') {
          // Jumps inside a function body would escape the function's
          // parameter-scope save/restore. Reject them as a hard failure
          // of the call step; the caller's onFailure policy kicks in.
          throw new JumpOutOfBlockError(outcome.targetStepId);
        }
        this.context.incrementCompleted();
      }
      this.context.logger.info(
        { function: name, depth: this.callDepth },
        `Function "${name}" complete`,
      );
    } finally {
      this.callDepth -= 1;
      for (const [k, prev] of savedVars) {
        if (prev === undefined) {
          this.context.deleteVariable(k);
        } else {
          this.context.setVariable(k, prev);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Condition  (MVP: evaluate and log; step jumping is future work)
  // ---------------------------------------------------------------------------

  private async executeCondition(step: Step): Promise<void> {
    const action = step.action as ConditionAction;

    // Runtime re-validation in case a malformed JSON slipped past schema validation
    // (e.g., if someone constructed a Step programmatically). Schema refinement
    // already enforces this at parse time for files loaded via AutomationSchema.
    const hasAi = action.ai !== undefined && action.ai.trim().length > 0;
    const hasCheck = action.check !== undefined;
    if (hasAi && hasCheck) {
      throw new Error(
        `Step "${step.id}": condition must use either "check" (deterministic) or "ai" (plain-English), not both.`,
      );
    }
    if (!hasAi && !hasCheck) {
      throw new Error(
        `Step "${step.id}": condition requires one of "check" or "ai".`,
      );
    }

    let result = false;
    let reasoning: string | undefined;

    if (hasAi) {
      const question = this.context.resolveTemplate(action.ai!);
      const pageContext = await this.contextCapture.capture();
      const evaluation = await this.llmService.evaluateCondition({
        question,
        pageContext,
      });
      result = evaluation.result;
      reasoning = evaluation.reasoning;
      this.context.logger.info(
        {
          stepId: step.id,
          question,
          result,
          confidence: evaluation.confidence,
          reasoning,
        },
        `AI condition evaluated to ${result}`,
      );
    } else {
      if (action.value === undefined) {
        throw new Error(
          `Step "${step.id}": condition with "check" requires a "value".`,
        );
      }
      // Condition step's schema does not allow 'element_missing' — the
      // four remaining cases are covered by the shared helper.
      result = await this.runDeterministicCheck(
        action.check as 'element_exists' | 'url_matches' | 'text_contains' | 'variable_equals',
        action.value,
      );

      this.context.logger.info(
        {
          stepId: step.id,
          check: action.check,
          result,
          thenStep: action.thenStep ?? null,
          elseStep: action.elseStep ?? null,
        },
        `Condition evaluated to ${result}`,
      );
    }

    // Expose the condition result as a context variable so later steps can
    // reference it via templates, e.g. {{<stepId>_result}}.
    this.context.setVariable(`${step.id}_result`, String(result));
    if (reasoning !== undefined) {
      this.context.setVariable(`${step.id}_reasoning`, reasoning);
    }

    // Branching: thenStep/elseStep jumps take precedence over thenCall/elseCall.
    // Jumps set a pendingJump that executeWithPolicy reads out after this step
    // returns. Function calls execute inline (existing behavior).
    //
    // Schema refinement guarantees thenStep+thenCall are mutually exclusive —
    // same for elseStep+elseCall — so the if/else-if cascade is unambiguous.
    if (result && action.thenStep) {
      const targetId = this.context.resolveTemplate(action.thenStep);
      this.context.logger.info(
        { stepId: step.id, thenStep: targetId },
        `Condition true — jumping to step "${targetId}"`,
      );
      this.pendingJump = targetId;
    } else if (result && action.thenCall) {
      const fnName = this.context.resolveTemplate(action.thenCall);
      this.context.logger.info(
        { stepId: step.id, thenCall: fnName },
        `Condition true — invoking thenCall function "${fnName}"`,
      );
      await this.invokeFunction(fnName, {}, step.id);
    } else if (!result && action.elseStep) {
      const targetId = this.context.resolveTemplate(action.elseStep);
      this.context.logger.info(
        { stepId: step.id, elseStep: targetId },
        `Condition false — jumping to step "${targetId}"`,
      );
      this.pendingJump = targetId;
    } else if (!result && action.elseCall) {
      const fnName = this.context.resolveTemplate(action.elseCall);
      this.context.logger.info(
        { stepId: step.id, elseCall: fnName },
        `Condition false — invoking elseCall function "${fnName}"`,
      );
      await this.invokeFunction(fnName, {}, step.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------

  private async executeDownload(step: Step): Promise<void> {
    const action = step.action as DownloadAction;

    this.context.logger.debug(
      { stepId: step.id, trigger: action.trigger },
      'Setting up download handler',
    );

    let downloadPath: string;

    if (action.trigger === 'click') {
      if (!step.selectors?.primary) {
        throw new Error(`Step "${step.id}": download with trigger "click" requires a selector.`);
      }

      // Resolve template variables in selectors before element resolution
      const resolvedPrimary = this.context.resolveTemplate(step.selectors.primary);
      const resolvedFallbacks = step.selectors.fallbacks?.map((f) =>
        this.context.resolveTemplate(f),
      );

      const resolved = await this.elementResolver.resolve(
        resolvedPrimary,
        resolvedFallbacks,
        step.aiGuidance,
        step.description ?? step.name,
      );

      downloadPath = await this.pageService.waitForDownload(async () => {
        await this.pageService.click(resolved.selector);
      });
    } else {
      // 'navigation' trigger — wait for a download event during the next navigation
      downloadPath = await this.pageService.waitForDownload(async () => {
        await this.pageService.waitForNavigation();
      });
    }

    this.context.addArtifact(downloadPath);
    this.context.logger.info({ stepId: step.id, downloadPath }, 'Download captured');
  }

  // ---------------------------------------------------------------------------
  // Post-step validation
  // ---------------------------------------------------------------------------

  private async validateStep(step: Step): Promise<void> {
    if (!step.validation) return;

    const { type, value } = step.validation;

    switch (type) {
      case 'url_contains': {
        const url = await this.pageService.getUrl();
        if (!url.includes(value)) {
          throw new Error(
            `Validation failed for step "${step.id}": expected URL to contain "${value}" but got "${url}".`,
          );
        }
        break;
      }

      case 'element_visible': {
        const exists = await this.pageService.elementExists(value);
        if (!exists) {
          throw new Error(
            `Validation failed for step "${step.id}": expected element "${value}" to be visible.`,
          );
        }
        break;
      }

      case 'text_present': {
        const html = await this.pageService.getHtml();
        if (!html.includes(value)) {
          throw new Error(
            `Validation failed for step "${step.id}": expected page to contain text "${value}".`,
          );
        }
        break;
      }

      case 'title_contains': {
        const title = await this.pageService.getTitle();
        if (!title.includes(value)) {
          throw new Error(
            `Validation failed for step "${step.id}": expected title to contain "${value}" but got "${title}".`,
          );
        }
        break;
      }

      default: {
        const exhaustive: never = type;
        throw new Error(`Unknown validation type: ${String(exhaustive)}`);
      }
    }

    this.context.logger.debug({ stepId: step.id, validationType: type }, 'Validation passed');
  }
}
