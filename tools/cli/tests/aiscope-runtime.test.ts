import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { RunContext } from '../src/runner/run-context.js';
import { StepExecutor } from '../src/runner/step-executor.js';
import type { Step } from '@portalflow/schema';
import type { NextActionResult, PageContext } from '../src/llm/provider.interface.js';

const logger = pino({ level: 'silent' });

/**
 * Unit tests for the aiscope agent loop. The tests mock PageService,
 * PageContextCapture, and LlmService with stubs that fire predictable
 * decisions so we can exercise budget enforcement, dispatch handling,
 * allowedActions filtering, and success-check short-circuiting without
 * touching a real browser or real provider.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface MockEnv {
  ctx: RunContext;
  exec: StepExecutor;
  pageService: any;
  contextCapture: any;
  llmService: any;
  captureCalls: Array<{ includeScreenshot?: boolean }>;
  decideCalls: Array<{ goal: string; hasScreenshot: boolean }>;
  pageContextFactory: () => PageContext;
}

function buildEnv(options: {
  decideSequence: NextActionResult[];
  successCheckResults: boolean[];
  pageServiceOverrides?: Record<string, (...args: unknown[]) => unknown>;
}): MockEnv {
  const ctx = new RunContext('test', logger);
  const captureCalls: MockEnv['captureCalls'] = [];
  const decideCalls: MockEnv['decideCalls'] = [];
  const dispatched: Array<{ action: string; selector?: string; value?: string }> = [];

  // Default: every page action succeeds silently. Tests that want a
  // specific PageService method to throw pass an override map.
  const defaultPageService: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    navigate: async () => undefined,
    click: async () => undefined,
    type: async () => undefined,
    selectOption: async () => undefined,
    check: async () => undefined,
    uncheck: async () => undefined,
    hover: async () => undefined,
    focus: async () => undefined,
    delay: async () => undefined,
    scroll: async () => undefined,
    elementExists: async () => false,
    getUrl: async () => 'https://example.test/',
    getHtml: async () => '<html></html>',
  };
  const pageServiceStub = new Proxy(
    { ...defaultPageService, ...options.pageServiceOverrides },
    {
      get(target, prop) {
        const fn = (target as Record<string, unknown>)[prop as string];
        if (typeof fn !== 'function') return undefined;
        return async (...args: unknown[]) => {
          dispatched.push({
            action: String(prop),
            selector: typeof args[0] === 'string' ? (args[0] as string) : undefined,
            value: typeof args[1] === 'string' ? (args[1] as string) : undefined,
          });
          return (fn as (...a: unknown[]) => unknown)(...args);
        };
      },
    },
  ) as any;

  const pageContextFactory = (): PageContext => ({
    url: 'https://example.test/',
    title: 'Test',
    html: '<html><body>test</body></html>',
    screenshot: 'base64-screenshot-data',
  });

  const contextCapture: any = {
    capture: vi.fn(async (opts?: { includeScreenshot?: boolean }) => {
      captureCalls.push({ includeScreenshot: opts?.includeScreenshot });
      const pc = pageContextFactory();
      if (!opts?.includeScreenshot) delete pc.screenshot;
      return pc;
    }),
  };

  let successCheckIdx = 0;
  const llmService: any = {
    evaluateCondition: vi.fn(async () => {
      const result = options.successCheckResults[successCheckIdx] ?? false;
      successCheckIdx += 1;
      return { result, confidence: 0.9, reasoning: 'mock' };
    }),
    decideNextAction: vi.fn(
      async (query: { goal: string; pageContext: PageContext }) => {
        const next = options.decideSequence[decideCalls.length] ?? {
          action: 'done',
          reasoning: 'no more decisions',
        };
        decideCalls.push({
          goal: query.goal,
          hasScreenshot: query.pageContext.screenshot !== undefined,
        });
        return next;
      },
    ),
  };

  const browserService: any = { screenshot: async () => 'noop' };
  const elementResolver: any = { resolve: async () => ({}) };
  const tools = new Map();
  const functions = new Map();

  const exec = new StepExecutor(
    pageServiceStub,
    elementResolver,
    tools,
    ctx,
    browserService,
    false, // screenshotOnFailure
    contextCapture,
    llmService,
    functions,
  );

  return {
    ctx,
    exec,
    pageService: pageServiceStub,
    contextCapture,
    llmService,
    captureCalls,
    decideCalls,
    pageContextFactory,
  };
}

function aiscopeStep(overrides: Partial<{
  goal: string;
  check: string;
  checkValue: string;
  ai: string;
  maxDurationSec: number;
  maxIterations: number;
  includeScreenshot: boolean;
  allowedActions: string[];
}>): Step {
  const {
    goal = 'Test goal',
    check,
    checkValue,
    ai,
    maxDurationSec = 300,
    maxIterations = 25,
    includeScreenshot = true,
    allowedActions,
  } = overrides;

  const successCheck: Record<string, unknown> =
    ai !== undefined
      ? { ai }
      : check !== undefined
        ? { check, value: checkValue ?? '' }
        : { check: 'text_contains', value: 'test' };

  return {
    id: 'step-aiscope',
    name: 'Aiscope test',
    type: 'aiscope',
    action: {
      goal,
      successCheck,
      maxDurationSec,
      maxIterations,
      includeScreenshot,
      ...(allowedActions ? { allowedActions } : {}),
    } as Step['action'],
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 0,
  };
}

describe('StepExecutor · executeAiScope', () => {
  it('succeeds immediately when the successCheck passes on iteration 1', async () => {
    const env = buildEnv({
      decideSequence: [], // never called
      successCheckResults: [true],
      pageServiceOverrides: {
        elementExists: async () => true,
      },
    });
    const step = aiscopeStep({
      check: 'element_exists',
      checkValue: 'button#accept',
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('continue');
    expect(env.llmService.decideNextAction).not.toHaveBeenCalled();
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('success');
  });

  it('aborts with a clear error when the iteration cap is exhausted', async () => {
    // LLM keeps clicking something that never satisfies the check.
    const env = buildEnv({
      decideSequence: Array(10).fill({
        action: 'click',
        selector: 'button#x',
        reasoning: 'clicking',
      }),
      successCheckResults: Array(10).fill(false),
      pageServiceOverrides: {
        elementExists: async () => false,
      },
    });
    const step = aiscopeStep({
      check: 'element_exists',
      checkValue: 'button#never-shows-up',
      maxIterations: 3,
      maxDurationSec: 300,
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('abort');
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('failed');
    const err = env.ctx.getVariable('step-aiscope_error') ?? '';
    expect(err).toContain('3-iteration budget');
    expect(err).toContain('Test goal');
    expect(env.llmService.decideNextAction).toHaveBeenCalledTimes(3);
  });

  it('aborts with a clear error when the wall-clock budget is exceeded', async () => {
    // Use fake timers so we can advance time between iterations without
    // actually sleeping. We control `Date.now()` via the mock clock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T00:00:00.000Z'));

    // Make decideNextAction advance time 3s on each call — the 2-second
    // budget should trip at the top of iteration 2.
    const env = buildEnv({
      decideSequence: [
        { action: 'click', selector: 'a', reasoning: '1' },
        { action: 'click', selector: 'b', reasoning: '2' },
      ],
      successCheckResults: [false, false, false],
    });

    // Wrap decideNextAction so each call advances the clock
    const originalDecide = env.llmService.decideNextAction;
    env.llmService.decideNextAction = vi.fn(async (q: unknown) => {
      vi.advanceTimersByTime(3000);
      return originalDecide(q);
    });

    const step = aiscopeStep({
      check: 'text_contains',
      checkValue: 'GOAL_REACHED',
      maxDurationSec: 2,
      maxIterations: 50,
    });

    const promise = env.exec.executeWithPolicy(step);
    // Because the LLM advances the clock inside an async call, we need
    // to let the microtask queue drain between timer advances.
    await promise.catch(() => undefined);

    const err = env.ctx.getVariable('step-aiscope_error') ?? '';
    expect(err).toContain('wall-clock budget of 2s');
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('failed');

    vi.useRealTimers();
  });

  it('captures dispatch failures in recent history and keeps looping', async () => {
    // First iteration: LLM clicks a bad selector, dispatch throws.
    // Second iteration: LLM clicks a good selector — successCheck true.
    let successCount = 0;
    const env = buildEnv({
      decideSequence: [
        { action: 'click', selector: 'button.bad', reasoning: '1' },
        { action: 'click', selector: 'button.good', reasoning: '2' },
      ],
      successCheckResults: [false, false, true],
      pageServiceOverrides: {
        click: async (selector: unknown) => {
          if (selector === 'button.bad') {
            throw new Error('element not found');
          }
          successCount += 1;
        },
      },
    });
    // Use ai: successCheck so the mocked evaluateCondition drives the
    // pass/fail sequence — deterministic checks would always return
    // false against the stub HTML.
    const step = aiscopeStep({
      ai: 'Did the click succeed?',
      maxIterations: 5,
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('continue');
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('success');
    // The failed dispatch should have been recorded in the history
    // passed to the SECOND decideNextAction call.
    const secondCallArgs = env.llmService.decideNextAction.mock.calls[1][0];
    expect(secondCallArgs.recentHistory.length).toBeGreaterThan(0);
    const failedEntry = secondCallArgs.recentHistory.find(
      (h: { succeeded: boolean }) => !h.succeeded,
    );
    expect(failedEntry).toBeDefined();
    expect(failedEntry.error).toContain('element not found');
    expect(successCount).toBe(1);
  });

  it('treats LLM "done" as a hint — loop continues until successCheck agrees', async () => {
    // Iteration 1: LLM says "done", check still false.
    // Iteration 2: LLM says "click", check still false.
    // Iteration 3: check finally passes.
    const env = buildEnv({
      decideSequence: [
        { action: 'done', reasoning: 'I think we are done' },
        { action: 'click', selector: 'button.final', reasoning: 'last click' },
      ],
      successCheckResults: [false, false, true],
    });
    const step = aiscopeStep({
      ai: 'Is the goal reached?',
      maxIterations: 5,
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('continue');
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('success');
    expect(env.llmService.decideNextAction).toHaveBeenCalledTimes(2);
  });

  it('rejects LLM actions outside allowedActions and keeps looping', async () => {
    const env = buildEnv({
      decideSequence: [
        // First the LLM picks a disallowed action
        { action: 'eval', value: 'window.hack()', reasoning: '' },
        // Then it picks a valid one
        { action: 'click', selector: 'button', reasoning: '' },
      ],
      successCheckResults: [false, false, true],
    });
    const step = aiscopeStep({
      ai: 'Is the goal reached?',
      maxIterations: 5,
      allowedActions: ['click', 'done'],
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('continue');
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('success');
    // History for the second call should contain the rejected action
    const secondCallArgs = env.llmService.decideNextAction.mock.calls[1][0];
    const rejected = secondCallArgs.recentHistory.find(
      (h: { action: string }) => h.action === 'eval',
    );
    expect(rejected).toBeDefined();
    expect(rejected.succeeded).toBe(false);
    expect(rejected.error).toContain('not in the allowed list');
  });

  it('forwards the screenshot to decideNextAction when includeScreenshot is true', async () => {
    const env = buildEnv({
      decideSequence: [{ action: 'done', reasoning: 'easy' }],
      successCheckResults: [false, true],
    });
    const step = aiscopeStep({
      check: 'text_contains',
      checkValue: 'x',
      includeScreenshot: true,
    });

    await env.exec.executeWithPolicy(step);

    const firstCall = env.llmService.decideNextAction.mock.calls[0][0];
    expect(firstCall.pageContext.screenshot).toBe('base64-screenshot-data');
    // contextCapture was called with includeScreenshot: true
    expect(env.captureCalls[0].includeScreenshot).toBe(true);
  });

  it('omits the screenshot when includeScreenshot is false', async () => {
    const env = buildEnv({
      decideSequence: [{ action: 'done', reasoning: 'easy' }],
      successCheckResults: [false, true],
    });
    const step = aiscopeStep({
      check: 'text_contains',
      checkValue: 'x',
      includeScreenshot: false,
    });

    await env.exec.executeWithPolicy(step);

    const firstCall = env.llmService.decideNextAction.mock.calls[0][0];
    expect(firstCall.pageContext.screenshot).toBeUndefined();
    expect(env.captureCalls[0].includeScreenshot).toBe(false);
  });

  it('evaluates an AI successCheck via llmService.evaluateCondition', async () => {
    const env = buildEnv({
      decideSequence: [{ action: 'click', selector: 'button', reasoning: '' }],
      successCheckResults: [true],
    });
    const step = aiscopeStep({
      ai: 'Is the login form visible?',
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('continue');
    expect(env.llmService.evaluateCondition).toHaveBeenCalledTimes(1);
    const callArg = env.llmService.evaluateCondition.mock.calls[0][0];
    expect(callArg.question).toBe('Is the login form visible?');
    expect(env.llmService.decideNextAction).not.toHaveBeenCalled();
  });
});
