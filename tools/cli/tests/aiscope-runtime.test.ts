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
    // Iteration 3: check finally passes. Because successCheck is AI,
    // decideNextAction runs speculatively on every iteration — including
    // the third — and its result is discarded when the check wins. So
    // the mock needs three decision entries and three calls are observed.
    const env = buildEnv({
      decideSequence: [
        { action: 'done', reasoning: 'I think we are done' },
        { action: 'click', selector: 'button.final', reasoning: 'last click' },
        { action: 'click', selector: 'button.speculative', reasoning: 'discarded' },
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
    // Three iterations → three speculative decideNextAction calls. The
    // last one is thrown away because the success check won the race.
    expect(env.llmService.decideNextAction).toHaveBeenCalledTimes(3);
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
    // AI successCheck path now runs evaluateCondition and
    // decideNextAction speculatively in parallel. When the check wins
    // on the first iteration, decideNextAction's result is discarded —
    // but the call was still made.
    const env = buildEnv({
      decideSequence: [{ action: 'click', selector: 'button', reasoning: 'speculative' }],
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
    // Speculative: decideNextAction was called in parallel with the
    // success check. Its result was discarded when the check won.
    expect(env.llmService.decideNextAction).toHaveBeenCalledTimes(1);
  });

  it('resolves {{var}} references in the goal before sending to the LLM', async () => {
    // Parallel AI successCheck path: each iteration calls decideNextAction
    // speculatively alongside evaluateCondition. Two iterations → two calls.
    const env = buildEnv({
      decideSequence: [
        { action: 'done', reasoning: 'trivial' },
        { action: 'done', reasoning: 'speculative discarded' },
      ],
      successCheckResults: [false, true], // iter1 check false → decide → iter2 check true
    });
    env.ctx.setVariable('banner_type', 'cookie');

    const step: Step = {
      id: 'step-aiscope',
      name: 'templated goal',
      type: 'aiscope',
      action: {
        goal: 'Dismiss the {{banner_type}} banner',
        successCheck: { ai: 'Is the banner gone?' },
        maxDurationSec: 300,
        maxIterations: 3,
        includeScreenshot: true,
      } as Step['action'],
      onFailure: 'abort',
      maxRetries: 0,
      timeout: 0,
    };

    await env.exec.executeWithPolicy(step);

    expect(env.llmService.decideNextAction).toHaveBeenCalledTimes(2);
    const sentGoal = env.llmService.decideNextAction.mock.calls[0][0].goal;
    expect(sentGoal).toBe('Dismiss the cookie banner');
    expect(sentGoal).not.toContain('{{');
  });

  it('propagates the resolved goal into the iteration-budget error message', async () => {
    const env = buildEnv({
      decideSequence: Array(5).fill({
        action: 'click',
        selector: 'button',
        reasoning: '',
      }),
      successCheckResults: Array(5).fill(false),
    });
    env.ctx.setVariable('target', 'checkout');

    const step: Step = {
      id: 'step-aiscope',
      name: 'templated goal budget',
      type: 'aiscope',
      action: {
        goal: 'Navigate to the {{target}} page',
        successCheck: { ai: 'Are we there yet?' },
        maxDurationSec: 300,
        maxIterations: 2,
        includeScreenshot: false,
      } as Step['action'],
      onFailure: 'abort',
      maxRetries: 0,
      timeout: 0,
    };

    await env.exec.executeWithPolicy(step);

    const err = (env.ctx.getVariable('step-aiscope_error') ?? '') as string;
    expect(err).toContain('Navigate to the checkout page');
    expect(err).not.toContain('{{target}}');
  });

  it('rejects "done" when the user explicitly excludes it from allowedActions', async () => {
    // Iteration 1: LLM emits `done` but allowedActions omits it → should
    // be rejected as "not in the allowed list" (history records failure,
    // loop continues).
    // Iteration 2: LLM emits a valid `click`, successCheck finally passes.
    const env = buildEnv({
      decideSequence: [
        { action: 'done', reasoning: 'I think we are done' },
        { action: 'click', selector: 'button.ok', reasoning: 'final click' },
      ],
      successCheckResults: [false, false, true],
    });
    const step = aiscopeStep({
      ai: 'Is the goal reached?',
      maxIterations: 5,
      allowedActions: ['click'], // note: no "done"
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('continue');
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('success');
    // History passed on the 2nd call should carry the rejection for `done`
    const secondCallArgs = env.llmService.decideNextAction.mock.calls[1][0];
    const rejected = secondCallArgs.recentHistory.find(
      (h: { action: string }) => h.action === 'done',
    );
    expect(rejected).toBeDefined();
    expect(rejected.succeeded).toBe(false);
    expect(rejected.error).toContain('not in the allowed list');
  });

  it('forwards the screenshot to evaluateCondition on AI successCheck when includeScreenshot is true', async () => {
    const env = buildEnv({
      decideSequence: [{ action: 'click', selector: 'button', reasoning: 'speculative' }],
      successCheckResults: [true],
    });
    const step = aiscopeStep({
      ai: 'Is the login form visible?',
      includeScreenshot: true,
    });

    await env.exec.executeWithPolicy(step);

    expect(env.llmService.evaluateCondition).toHaveBeenCalledTimes(1);
    const callArg = env.llmService.evaluateCondition.mock.calls[0][0];
    expect(callArg.pageContext.screenshot).toBe('base64-screenshot-data');
  });

  // ---------------------------------------------------------------------
  // Parallel speculative execution for AI successCheck
  // ---------------------------------------------------------------------

  it('runs evaluateCondition and decideNextAction in parallel when successCheck is AI', async () => {
    // Measure timing: if the calls ran sequentially, total latency would
    // be ~400ms (2 x 200ms). If parallel, ~200ms. Give the assertion a
    // generous cushion to avoid flakes on slow CI.
    const env = buildEnv({
      decideSequence: [{ action: 'click', selector: 'button', reasoning: 'speculative' }],
      successCheckResults: [true],
    });

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Wrap the mocks to add 200ms latency each.
    const origEval = env.llmService.evaluateCondition;
    env.llmService.evaluateCondition = vi.fn(async (q: unknown) => {
      await delay(200);
      return origEval(q);
    });
    const origDecide = env.llmService.decideNextAction;
    env.llmService.decideNextAction = vi.fn(async (q: unknown) => {
      await delay(200);
      return origDecide(q);
    });

    const step = aiscopeStep({
      ai: 'Is the login form visible?',
    });

    const t0 = Date.now();
    await env.exec.executeWithPolicy(step);
    const elapsed = Date.now() - t0;

    // Sequential would be ~400ms+; parallel should be ~200-300ms. Assert
    // an upper bound that's clearly below the sequential floor.
    expect(elapsed).toBeLessThan(350);
    expect(env.llmService.evaluateCondition).toHaveBeenCalledTimes(1);
    expect(env.llmService.decideNextAction).toHaveBeenCalledTimes(1);
  });

  it('discards the speculative decideNextAction result when the AI check wins', async () => {
    // Iteration 1: check true immediately, decideNextAction speculatively
    // returns a click action. If the runner honored that action instead
    // of discarding it, the stubbed click would throw and fail the step.
    const env = buildEnv({
      decideSequence: [
        { action: 'click', selector: 'button.forbidden', reasoning: 'speculative' },
      ],
      successCheckResults: [true],
      pageServiceOverrides: {
        click: async () => {
          throw new Error(
            'pageService.click was called — the speculative decision should have been discarded',
          );
        },
      },
    });
    const step = aiscopeStep({
      ai: 'Is the login form visible?',
    });

    const outcome = await env.exec.executeWithPolicy(step);

    expect(outcome).toBe('continue');
    expect(env.ctx.getVariable('step-aiscope_status')).toBe('success');
  });

  it('does not parallelize when successCheck is deterministic', async () => {
    // Deterministic checks are cheap (DOM query), so the parallel path
    // would waste a real LLM call on goal-reached iterations. Verify
    // that decideNextAction is NOT called when an element_exists check
    // wins on the first iteration.
    const env = buildEnv({
      decideSequence: [
        { action: 'click', selector: 'button', reasoning: 'should-not-run' },
      ],
      successCheckResults: [],
      pageServiceOverrides: {
        // The check wins immediately — the element exists.
        elementExists: async () => true,
      },
    });
    const step = aiscopeStep({
      check: 'element_exists',
      checkValue: 'button#accept',
    });

    await env.exec.executeWithPolicy(step);

    expect(env.ctx.getVariable('step-aiscope_status')).toBe('success');
    // Key assertion: no speculative decision call because the check is
    // synchronous and cheap — sequential is strictly better here.
    expect(env.llmService.decideNextAction).not.toHaveBeenCalled();
  });

  it('propagates a decideNextAction error only when the AI check fails', async () => {
    // Scenario A: check true → decide rejected → the rejection is
    // SWALLOWED because the goal is already reached.
    const envA = buildEnv({
      decideSequence: [],
      successCheckResults: [true],
    });
    envA.llmService.decideNextAction = vi.fn(async () => {
      throw new Error('provider 500');
    });
    const stepA = aiscopeStep({ ai: 'Is the goal reached?' });

    await envA.exec.executeWithPolicy(stepA);
    expect(envA.ctx.getVariable('step-aiscope_status')).toBe('success');

    // Scenario B: check false → decide rejected → the rejection IS
    // propagated and aborts the step.
    const envB = buildEnv({
      decideSequence: [],
      successCheckResults: [false],
    });
    envB.llmService.decideNextAction = vi.fn(async () => {
      throw new Error('provider 500');
    });
    const stepB = aiscopeStep({ ai: 'Is the goal reached?', maxIterations: 3 });

    const outcome = await envB.exec.executeWithPolicy(stepB);
    expect(outcome).toBe('abort');
    expect(envB.ctx.getVariable('step-aiscope_error') ?? '').toContain('provider 500');
  });

  // Regression: schema v1.1.0 made successCheck optional on AiScopeAction,
  // but cli v1's Playwright runner intentionally keeps the hard throw —
  // self-terminating mode is cli2-only. If someone accidentally ships an
  // automation authored in the extension's "LLM decides" mode into cli v1,
  // we want a clear runtime error, not silent divergence.
  it('rejects at runtime when successCheck is missing (cli v1 does not support self-terminating mode)', async () => {
    const env = buildEnv({
      decideSequence: [{ action: 'done', reasoning: 'trying to self-terminate' }],
      successCheckResults: [],
    });
    const step: Step = {
      id: 'step-aiscope',
      name: 'Aiscope self-terminating',
      type: 'aiscope',
      // Intentionally cast through unknown — schema allows omitting
      // successCheck; the runner is what enforces the cli-v1 restriction.
      action: {
        goal: 'Self-terminate via LLM done',
        maxDurationSec: 300,
        maxIterations: 25,
        includeScreenshot: true,
      } as unknown as Step['action'],
      onFailure: 'abort',
      maxRetries: 0,
      timeout: 0,
    };

    const outcome = await env.exec.executeWithPolicy(step);
    expect(outcome).toBe('abort');
    expect(env.ctx.getVariable('step-aiscope_error') ?? '').toContain('successCheck');
  });
});
