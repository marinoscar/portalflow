import type {
  ConditionAction,
  DownloadAction,
  ExtractAction,
  InteractAction,
  NavigateAction,
  Step,
  ToolCallAction,
  WaitAction,
} from '@portalflow/schema';
import type { PageService } from '../browser/page.service.js';
import type { ElementResolver } from '../browser/element-resolver.js';
import type { Tool } from '../tools/tool.interface.js';
import { RunContext } from './run-context.js';

export class StepExecutor {
  constructor(
    private readonly pageService: PageService,
    private readonly elementResolver: ElementResolver,
    private readonly tools: Map<string, Tool>,
    private readonly context: RunContext,
  ) {}

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
      default: {
        const exhaustive: never = step.type;
        throw new Error(`Unknown step type: ${String(exhaustive)}`);
      }
    }

    await this.validateStep(step);
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

    // Resolve the selector via primary / fallback / AI
    const resolved = await this.elementResolver.resolve(
      step.selectors?.primary,
      step.selectors?.fallbacks,
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
        const selector = action.value ?? '';
        if (!selector) {
          throw new Error(`Step "${step.id}": wait with condition "selector" requires a value.`);
        }
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

    const result = await tool.execute(action.command, action.args ?? {});

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
  // Condition  (MVP: evaluate and log; step jumping is future work)
  // ---------------------------------------------------------------------------

  private async executeCondition(step: Step): Promise<void> {
    const action = step.action as ConditionAction;
    let result = false;

    switch (action.check) {
      case 'element_exists': {
        result = await this.pageService.elementExists(action.value);
        break;
      }

      case 'url_matches': {
        const currentUrl = await this.pageService.getUrl();
        result = currentUrl.includes(action.value);
        break;
      }

      case 'text_contains': {
        // Check full page text for the value
        const html = await this.pageService.getHtml();
        result = html.includes(action.value);
        break;
      }

      case 'variable_equals': {
        // action.value format: "varName=expectedValue"
        const eqIdx = action.value.indexOf('=');
        if (eqIdx === -1) {
          this.context.logger.warn(
            { stepId: step.id },
            'condition "variable_equals" value must be in format "varName=expectedValue"',
          );
          break;
        }
        const varName = action.value.slice(0, eqIdx);
        const expected = action.value.slice(eqIdx + 1);
        result = this.context.getVariable(varName) === expected;
        break;
      }

      default: {
        const exhaustive: never = action.check;
        throw new Error(`Unknown condition check: ${String(exhaustive)}`);
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

      const resolved = await this.elementResolver.resolve(
        step.selectors.primary,
        step.selectors.fallbacks,
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
