import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { StepExecutor, JumpOutOfBlockError } from '../step-executor.js';
import { RunContext } from '../run-context.js';
import { RunPresenter } from '../run-presenter.js';
import type { PageClient } from '../../browser/page-client.js';
import type { ElementResolver } from '../../browser/element-resolver.js';
import type { PageContextCapture } from '../../browser/context.js';
import type { LlmService } from '../../llm/llm.service.js';
import type { Step } from '@portalflow/schema';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: 'silent' });

function makeContext(): RunContext {
  return new RunContext('test', logger);
}

/**
 * Build a minimal PageClient mock with all methods returning sensible defaults.
 * Tests can override individual methods via vi.fn().mockResolvedValue(...).
 */
function makePageClient(): PageClient {
  return {
    navigate: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
    uncheck: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    getText: vi.fn().mockResolvedValue('text-content'),
    getAttribute: vi.fn().mockResolvedValue('attr-value'),
    getHtml: vi.fn().mockResolvedValue('<html></html>'),
    getUrl: vi.fn().mockResolvedValue('https://example.com'),
    getTitle: vi.fn().mockResolvedValue('Example Page'),
    elementExists: vi.fn().mockResolvedValue(true),
    countMatching: vi.fn().mockResolvedValue(0),
    waitForDownload: vi.fn().mockResolvedValue('/downloads/file.pdf'),
    screenshot: vi.fn().mockResolvedValue('/screenshots/test.png'),
  } as unknown as PageClient;
}

function makeElementResolver(pageClient: PageClient): ElementResolver {
  return {
    resolve: vi.fn().mockImplementation(async (primary: string) => ({
      selector: primary ?? 'button',
      source: 'primary',
    })),
  } as unknown as ElementResolver;
}

function makeContextCapture(): PageContextCapture {
  return {
    capture: vi.fn().mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      html: '<html></html>',
    }),
  } as unknown as PageContextCapture;
}

function makeLlmService(): LlmService {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    findElement: vi.fn().mockResolvedValue({ selector: 'button', confidence: 0.9 }),
    decideNextAction: vi.fn().mockResolvedValue({
      action: 'done',
      reasoning: 'goal achieved',
    }),
    evaluateCondition: vi.fn().mockResolvedValue({ result: true, confidence: 0.9 }),
    findItems: vi.fn().mockResolvedValue({ items: [], explanation: '' }),
  } as unknown as LlmService;
}

function makeExecutor(overrides?: {
  pageClient?: PageClient;
  elementResolver?: ElementResolver;
  contextCapture?: PageContextCapture;
  llmService?: LlmService;
  context?: RunContext;
}) {
  const context = overrides?.context ?? makeContext();
  const pageClient = overrides?.pageClient ?? makePageClient();
  const elementResolver = overrides?.elementResolver ?? makeElementResolver(pageClient);
  const contextCapture = overrides?.contextCapture ?? makeContextCapture();
  const llmService = overrides?.llmService ?? makeLlmService();
  const presenter = new RunPresenter(false, '');

  return {
    executor: new StepExecutor(
      pageClient,
      elementResolver,
      new Map(),
      context,
      false,
      contextCapture,
      llmService,
      new Map(),
      presenter,
    ),
    context,
    pageClient,
    elementResolver,
    contextCapture,
    llmService,
  };
}

function makeStep(overrides: Partial<Step>): Step {
  return {
    id: 'step-1',
    name: 'Test Step',
    type: 'navigate',
    action: { url: 'https://example.com' },
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 30000,
    ...overrides,
  } as Step;
}

// ---------------------------------------------------------------------------
// Navigate
// ---------------------------------------------------------------------------

describe('StepExecutor — navigate', () => {
  it('calls pageClient.navigate with the resolved URL', async () => {
    const { executor, pageClient } = makeExecutor();
    const step = makeStep({ type: 'navigate', action: { url: 'https://example.com/page' } });

    await executor.executeWithPolicy(step);

    expect(pageClient.navigate).toHaveBeenCalledWith('https://example.com/page');
  });

  it('resolves template variables in the URL', async () => {
    const { executor, pageClient, context } = makeExecutor();
    context.setVariable('host', 'https://test.example.com');
    const step = makeStep({ type: 'navigate', action: { url: '{{host}}/page' } });

    await executor.executeWithPolicy(step);

    expect(pageClient.navigate).toHaveBeenCalledWith('https://test.example.com/page');
  });

  it('returns abort when navigate throws and onFailure is abort', async () => {
    const pageClient = makePageClient();
    (pageClient.navigate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('net error'));
    const { executor } = makeExecutor({ pageClient });
    const step = makeStep({ type: 'navigate', action: { url: 'https://fail.com' } });

    const result = await executor.executeWithPolicy(step);
    expect(result).toBe('abort');
  });

  it('returns continue when navigate throws and onFailure is skip', async () => {
    const pageClient = makePageClient();
    (pageClient.navigate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('net error'));
    const { executor } = makeExecutor({ pageClient });
    const step = makeStep({ type: 'navigate', action: { url: 'https://fail.com' }, onFailure: 'skip' });

    const result = await executor.executeWithPolicy(step);
    expect(result).toBe('continue');
  });
});

// ---------------------------------------------------------------------------
// Interact — click
// ---------------------------------------------------------------------------

describe('StepExecutor — interact click', () => {
  it('calls pageClient.click with the resolved selector', async () => {
    const { executor, pageClient } = makeExecutor();
    const step = makeStep({
      type: 'interact',
      action: { interaction: 'click' },
      selectors: { primary: '#submit-btn' },
    });

    await executor.executeWithPolicy(step);

    expect(pageClient.click).toHaveBeenCalledWith('#submit-btn');
  });
});

// ---------------------------------------------------------------------------
// Interact — type
// ---------------------------------------------------------------------------

describe('StepExecutor — interact type', () => {
  it('calls pageClient.type with literal value', async () => {
    const { executor, pageClient } = makeExecutor();
    const step = makeStep({
      type: 'interact',
      action: { interaction: 'type', value: 'hello world' },
      selectors: { primary: '#input' },
    });

    await executor.executeWithPolicy(step);

    expect(pageClient.type).toHaveBeenCalledWith('#input', 'hello world');
  });

  it('calls pageClient.type with value from inputRef', async () => {
    const { executor, pageClient, context } = makeExecutor();
    context.setVariable('mySecret', 'hunter2');
    const step = makeStep({
      type: 'interact',
      action: { interaction: 'type', inputRef: 'mySecret' },
      selectors: { primary: '#password' },
    });

    await executor.executeWithPolicy(step);

    expect(pageClient.type).toHaveBeenCalledWith('#password', 'hunter2');
  });

  it('throws when inputRef is not in context', async () => {
    const { executor, context } = makeExecutor();
    const step = makeStep({
      type: 'interact',
      action: { interaction: 'type', inputRef: 'missing' },
      selectors: { primary: '#input' },
      onFailure: 'abort',
    });

    const result = await executor.executeWithPolicy(step);
    expect(result).toBe('abort');
    expect(context.getVariable('step-1_error')).toMatch(/inputRef "missing" is not set/);
  });
});

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

describe('StepExecutor — extract', () => {
  it('extracts text and stores in context', async () => {
    const pageClient = makePageClient();
    (pageClient.getText as ReturnType<typeof vi.fn>).mockResolvedValue('extracted text');
    const { executor, context } = makeExecutor({ pageClient });
    const step = makeStep({
      type: 'extract',
      action: { target: 'text', outputName: 'myOutput' },
      selectors: { primary: 'h1' },
    });

    await executor.executeWithPolicy(step);

    expect(context.getVariable('myOutput')).toBe('extracted text');
  });

  it('extracts URL without a selector', async () => {
    const pageClient = makePageClient();
    (pageClient.getUrl as ReturnType<typeof vi.fn>).mockResolvedValue('https://example.com/page');
    const { executor, context } = makeExecutor({ pageClient });
    const step = makeStep({
      type: 'extract',
      action: { target: 'url', outputName: 'currentUrl' },
    });

    await executor.executeWithPolicy(step);

    expect(context.getVariable('currentUrl')).toBe('https://example.com/page');
  });

  it('extracts title without a selector', async () => {
    const pageClient = makePageClient();
    (pageClient.getTitle as ReturnType<typeof vi.fn>).mockResolvedValue('My Page Title');
    const { executor, context } = makeExecutor({ pageClient });
    const step = makeStep({
      type: 'extract',
      action: { target: 'title', outputName: 'pageTitle' },
    });

    await executor.executeWithPolicy(step);

    expect(context.getVariable('pageTitle')).toBe('My Page Title');
  });
});

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

describe('StepExecutor — wait', () => {
  it('calls pageClient.delay for delay condition', async () => {
    const { executor, pageClient } = makeExecutor();
    const step = makeStep({
      type: 'wait',
      action: { condition: 'delay', value: '500' },
    });

    await executor.executeWithPolicy(step);

    expect(pageClient.delay).toHaveBeenCalledWith(500);
  });

  it('calls pageClient.waitForSelector for selector condition', async () => {
    const { executor, pageClient } = makeExecutor();
    const step = makeStep({
      type: 'wait',
      action: { condition: 'selector', value: '#loaded' },
    });

    await executor.executeWithPolicy(step);

    expect(pageClient.waitForSelector).toHaveBeenCalledWith('#loaded', 30000);
  });
});

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

describe('StepExecutor — condition', () => {
  it('evaluates variable_equals deterministic check', async () => {
    const { executor, context } = makeExecutor();
    context.setVariable('status', 'ok');
    const step = makeStep({
      type: 'condition',
      action: { check: 'variable_equals', value: 'status=ok' },
    });

    await executor.executeWithPolicy(step);

    expect(context.getVariable('step-1_result')).toBe('true');
  });

  it('sets pending jump when thenStep matches a true condition', async () => {
    const { executor, context } = makeExecutor();
    context.setVariable('flag', 'yes');
    const step = makeStep({
      id: 'cond-step',
      type: 'condition',
      action: { check: 'variable_equals', value: 'flag=yes', thenStep: 'target-step' },
    });

    const result = await executor.executeWithPolicy(step);

    expect(result).toEqual({ kind: 'jump', targetStepId: 'target-step' });
  });
});

// ---------------------------------------------------------------------------
// Goto
// ---------------------------------------------------------------------------

describe('StepExecutor — goto', () => {
  it('returns a jump outcome for the target step', async () => {
    const { executor } = makeExecutor();
    const step = makeStep({
      type: 'goto',
      action: { targetStepId: 'step-99' },
    });

    const result = await executor.executeWithPolicy(step);

    expect(result).toEqual({ kind: 'jump', targetStepId: 'step-99' });
  });
});

// ---------------------------------------------------------------------------
// Loop — discoverItems via countMatching
// ---------------------------------------------------------------------------

describe('StepExecutor — loop discoverItems', () => {
  it('synthesises nth-of-type selectors from countMatching result', async () => {
    const pageClient = makePageClient();
    (pageClient.countMatching as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const { executor, context } = makeExecutor({ pageClient });

    // A simple loop that iterates over discovered items
    const step = makeStep({
      id: 'loop-step',
      type: 'loop',
      action: {
        maxIterations: 10,
        indexVar: 'i',
        items: {
          selectorPattern: '.row',
          description: 'rows',
          itemVar: 'currentRow',
          order: 'natural',
        },
      },
      substeps: [
        makeStep({
          id: 'inner-navigate',
          type: 'navigate',
          action: { url: 'https://example.com' },
        }),
      ],
    });

    await executor.executeWithPolicy(step);

    // countMatching should have been called with the selector pattern
    expect(pageClient.countMatching).toHaveBeenCalledWith('.row');
    // navigate should have been called 3 times (one per discovered item)
    expect(pageClient.navigate).toHaveBeenCalledTimes(3);
    // itemVar should be set to the nth-of-type selectors
    expect(context.getVariable('currentRow')).toBe('.row:nth-of-type(3)');
  });
});

// ---------------------------------------------------------------------------
// aiscope — self-terminating mode (no successCheck)
// ---------------------------------------------------------------------------

function aiscopeSelfTerminatingStep(overrides?: Partial<{ maxIterations: number }>): Step {
  return {
    id: 'step-aiscope',
    name: 'Aiscope self-terminating',
    type: 'aiscope',
    action: {
      goal: 'Do the thing',
      maxDurationSec: 60,
      maxIterations: overrides?.maxIterations ?? 5,
      includeScreenshot: false,
      // successCheck intentionally omitted — the LLM's `done` is authoritative.
    },
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 0,
  } as Step;
}

describe('StepExecutor — aiscope self-terminating mode', () => {
  it('terminates immediately when the LLM emits "done" on iteration 1', async () => {
    const { executor, llmService } = makeExecutor();
    vi.mocked(llmService.decideNextAction).mockResolvedValueOnce({
      action: 'done',
      reasoning: 'goal reached',
    });

    await expect(executor.execute(aiscopeSelfTerminatingStep())).resolves.toBeUndefined();

    // Only one LLM call — no re-verification, no second iteration.
    expect(llmService.decideNextAction).toHaveBeenCalledTimes(1);
    // successCheck was never consulted because there is no check.
    expect(llmService.evaluateCondition).not.toHaveBeenCalled();
  });

  it('passes selfTerminating:true to decideNextAction when successCheck is omitted', async () => {
    const { executor, llmService } = makeExecutor();
    vi.mocked(llmService.decideNextAction).mockResolvedValueOnce({
      action: 'done',
      reasoning: 'done',
    });

    await executor.execute(aiscopeSelfTerminatingStep());

    const firstCall = vi.mocked(llmService.decideNextAction).mock.calls[0][0];
    expect(firstCall.selfTerminating).toBe(true);
  });

  it('throws with a budget-exhaustion error when the LLM never emits "done"', async () => {
    const { executor, llmService } = makeExecutor();
    // Every iteration picks a no-op wait — model keeps thinking it's not done.
    vi.mocked(llmService.decideNextAction).mockResolvedValue({
      action: 'wait',
      value: '100',
      reasoning: 'still working',
    });

    await expect(executor.execute(aiscopeSelfTerminatingStep({ maxIterations: 3 }))).rejects.toThrow(
      /exhausted the 3-iteration budget without reaching the goal/,
    );
    expect(llmService.decideNextAction).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// aiscope — successCheck present (done remains a hint)
// ---------------------------------------------------------------------------

describe('StepExecutor — aiscope with successCheck treats done as a hint', () => {
  it('continues looping when the LLM emits "done" but the deterministic check disagrees', async () => {
    const { executor, llmService, pageClient } = makeExecutor();

    // Iteration 1: check fails (element not on page), LLM emits "done".
    //  → with successCheck present, "done" is a hint → loop continues.
    // Iteration 2: check passes → loop exits.
    vi.mocked(pageClient.elementExists)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.mocked(llmService.decideNextAction).mockResolvedValueOnce({
      action: 'done',
      reasoning: 'I think we are done',
    });

    const step: Step = {
      id: 'step-aiscope',
      name: 'Aiscope with check',
      type: 'aiscope',
      action: {
        goal: 'Click accept',
        successCheck: { check: 'element_exists', value: 'button.accepted' },
        maxDurationSec: 60,
        maxIterations: 5,
        includeScreenshot: false,
      },
      onFailure: 'abort',
      maxRetries: 0,
      timeout: 0,
    } as Step;

    await expect(executor.execute(step)).resolves.toBeUndefined();

    // elementExists called twice: once per iteration's pre-check.
    expect(pageClient.elementExists).toHaveBeenCalledTimes(2);
    // LLM called exactly once — the "done" on iter 1; iter 2 short-circuits
    // before decideNextAction because the deterministic check already passed.
    expect(llmService.decideNextAction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// JumpOutOfBlockError
// ---------------------------------------------------------------------------

describe('JumpOutOfBlockError', () => {
  it('is an Error with the correct name', () => {
    const err = new JumpOutOfBlockError('target');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('JumpOutOfBlockError');
    expect(err.targetStepId).toBe('target');
  });
});
