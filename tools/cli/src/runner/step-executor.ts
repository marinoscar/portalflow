import type {
  CallAction,
  ConditionAction,
  DownloadAction,
  ExtractAction,
  FunctionDefinition,
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
import type { Tool } from '../tools/tool.interface.js';
import { RunContext } from './run-context.js';

const RETRY_BASE_DELAY_MS = 1_000;
const MAX_CALL_DEPTH = 16;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StepExecutor {
  private callDepth = 0;

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
  ) {}

  /**
   * Executes a step with its retry/skip/abort policy.
   * Returns true if execution should continue to the next step, false to abort.
   */
  async executeWithPolicy(step: Step): Promise<boolean> {
    const policy = step.onFailure;
    const maxRetries = step.maxRetries;
    let attempts = 0;

    while (true) {
      try {
        await this.execute(step);
        return true; // success
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts += 1;

        if (policy === 'retry' && attempts <= maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempts - 1);
          this.context.logger.warn(
            { stepId: step.id, attempt: attempts, maxRetries, delayMs: delay },
            `Step failed (attempt ${attempts}/${maxRetries}), retrying after ${delay}ms: ${message}`,
          );
          await sleep(delay);
          continue;
        }

        // Record the error
        this.context.addError(step.id, step.name, message);

        if (policy === 'skip') {
          this.context.logger.warn(
            { stepId: step.id, policy: 'skip' },
            `Step failed and will be skipped: ${message}`,
          );
          return true; // continue to next step
        }

        // abort (or retry exhausted)
        this.context.logger.error(
          { stepId: step.id, policy },
          `Step failed — aborting run: ${message}`,
        );

        if (this.screenshotOnFailure) {
          try {
            const screenshotPath = await this.browserService.screenshot(`failure_${step.id}`);
            this.context.addArtifact(screenshotPath);
            this.context.logger.info({ screenshotPath }, 'Failure screenshot captured');
          } catch (screenshotErr) {
            this.context.logger.warn(
              { err: String(screenshotErr) },
              'Failed to capture failure screenshot',
            );
          }
        }

        return false; // stop execution
      }
    }
  }

  async execute(step: Step): Promise<void> {
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
      default: {
        const exhaustive: never = step.type;
        throw new Error(`Unknown step type: ${String(exhaustive)}`);
      }
    }

    await this.validateStep(step);
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
        const success = await this.executeWithPolicy(substep);
        if (!success) {
          substepAborted = true;
          break;
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
    const page = this.browserService.getPage();
    const value = this.context.resolveTemplate(cond.value);
    switch (cond.check) {
      case 'element_exists':
        return !!(await page.$(value).catch(() => null));
      case 'element_missing':
        return !(await page.$(value).catch(() => null));
      case 'url_matches':
        return page.url().includes(value);
      case 'text_contains': {
        const content = await page.content();
        return content.includes(value);
      }
      case 'variable_equals': {
        const eqIdx = value.indexOf('=');
        if (eqIdx === -1) return false;
        const varName = value.slice(0, eqIdx).trim();
        const expected = value.slice(eqIdx + 1).trim();
        return this.context.getVariable(varName) === expected;
      }
      default: {
        const exhaustive: never = cond.check;
        throw new Error(`Unknown exit condition: ${String(exhaustive)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Navigate
  // ---------------------------------------------------------------------------

  private async executeNavigate(step: Step): Promise<void> {
    const action = step.action as NavigateAction;
    const url = this.context.resolveTemplate(action.url);
    this.context.logger.debug({ stepId: step.id, url }, 'Navigating to URL');
    await this.pageService.navigate(url);
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
    const resolved = await this.elementResolver.resolve(
      resolvedPrimary,
      resolvedFallbacks,
      step.aiGuidance,
      step.description ?? step.name,
    );

    const selector = resolved.selector;
    this.context.logger.debug(
      { stepId: step.id, selector, source: resolved.source, interaction: action.interaction },
      'Resolved element for interaction',
    );

    switch (action.interaction) {
      case 'click':
        await this.pageService.click(selector);
        break;

      case 'type': {
        // Prefer inputRef (variable lookup) over literal value
        let text: string;
        if (action.inputRef) {
          const varValue = this.context.getVariable(action.inputRef);
          if (varValue === undefined) {
            throw new Error(
              `Step "${step.id}": inputRef "${action.inputRef}" is not set in context variables.`,
            );
          }
          text = varValue;
        } else {
          text = action.value !== undefined
            ? this.context.resolveTemplate(action.value)
            : '';
        }
        await this.pageService.type(selector, text);
        break;
      }

      case 'select': {
        const value = action.value !== undefined
          ? this.context.resolveTemplate(action.value)
          : '';
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

    switch (action.condition) {
      case 'selector': {
        const rawSelector = action.value ?? '';
        if (!rawSelector) {
          throw new Error(`Step "${step.id}": wait with condition "selector" requires a value.`);
        }
        const selector = this.context.resolveTemplate(rawSelector);
        await this.pageService.waitForSelector(selector, action.timeout);
        break;
      }

      case 'navigation':
        await this.pageService.waitForNavigation(action.value, action.timeout);
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
        await this.pageService.waitForNetworkIdle(action.timeout);
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

    this.context.logger.debug(
      { stepId: step.id, outputName: action.outputName },
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

    this.context.logger.debug(
      { stepId: step.id, tool: action.tool, command: action.command },
      'Executing tool call',
    );

    // Resolve template variables in tool call arguments
    const resolvedArgs = action.args
      ? Object.fromEntries(
          Object.entries(action.args).map(([k, v]) => [k, this.context.resolveTemplate(v)]),
        )
      : {};

    const result = await tool.execute(action.command, resolvedArgs);

    if (!result.success) {
      throw new Error(
        `Step "${step.id}": tool "${action.tool}" command "${action.command}" failed: ${result.error ?? 'unknown error'}`,
      );
    }

    if (action.outputName) {
      this.context.addOutput(action.outputName, result.output);
      this.context.setVariable(action.outputName, result.output);
      this.context.logger.debug(
        { stepId: step.id, outputName: action.outputName },
        'Tool output stored in context',
      );
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
        const ok = await this.executeWithPolicy(innerStep);
        if (!ok) {
          throw new Error(`Function "${name}" aborted at step "${innerStep.id}"`);
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
      const condValue = this.context.resolveTemplate(action.value);

      switch (action.check) {
        case 'element_exists': {
          result = await this.pageService.elementExists(condValue);
          break;
        }

        case 'url_matches': {
          const currentUrl = await this.pageService.getUrl();
          result = currentUrl.includes(condValue);
          break;
        }

        case 'text_contains': {
          const html = await this.pageService.getHtml();
          result = html.includes(condValue);
          break;
        }

        case 'variable_equals': {
          // condValue format: "varName=expectedValue"
          const eqIdx = condValue.indexOf('=');
          if (eqIdx === -1) {
            this.context.logger.warn(
              { stepId: step.id },
              'condition "variable_equals" value must be in format "varName=expectedValue"',
            );
            break;
          }
          const varName = condValue.slice(0, eqIdx);
          const expected = condValue.slice(eqIdx + 1);
          result = this.context.getVariable(varName) === expected;
          break;
        }

        default: {
          throw new Error(`Unknown condition check: ${String(action.check)}`);
        }
      }

      this.context.logger.info(
        {
          stepId: step.id,
          check: action.check,
          result,
          thenStep: action.thenStep ?? null,
          elseStep: action.elseStep ?? null,
        },
        `Condition evaluated to ${result} (step jumping is not yet implemented)`,
      );
    }

    // Expose the condition result as a context variable so later steps can
    // reference it via templates, e.g. {{<stepId>_result}}.
    this.context.setVariable(`${step.id}_result`, String(result));
    if (reasoning !== undefined) {
      this.context.setVariable(`${step.id}_reasoning`, reasoning);
    }

    // Branch into a named function based on the boolean result. No args are
    // passed — the function reads shared context. Schema refinement has
    // already validated that the referenced function exists.
    if (result && action.thenCall) {
      const fnName = this.context.resolveTemplate(action.thenCall);
      this.context.logger.info(
        { stepId: step.id, thenCall: fnName },
        `Condition true — invoking thenCall function "${fnName}"`,
      );
      await this.invokeFunction(fnName, {}, step.id);
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
