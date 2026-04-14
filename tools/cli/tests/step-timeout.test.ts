import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { RunContext } from '../src/runner/run-context.js';
import { StepExecutor } from '../src/runner/step-executor.js';
import type { Step } from '@portalflow/schema';

const logger = pino({ level: 'silent' });

/**
 * Tests for step-level timeout enforcement. Covers the two mechanisms:
 *
 *   (1) `executeWait` falls back to `step.timeout` when `action.timeout`
 *       is absent, so the top-level field actually governs wait steps.
 *   (2) `runWithStepTimeout` races leaf step bodies against a timer
 *       so hung operations surface a clear error. Composite step types
 *       (loop, call, aiscope) are exempt because they carry their own
 *       internal budgets.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface StubOptions {
  waitForSelectorImpl?: (selector: string, timeout?: number) => Promise<void>;
  waitForNetworkIdleImpl?: (timeout?: number) => Promise<void>;
  waitForNavigationImpl?: (urlPattern?: string, timeout?: number) => Promise<void>;
  delayImpl?: (ms: number) => Promise<void>;
}

function buildExec(opts: StubOptions = {}): {
  exec: StepExecutor;
  ctx: RunContext;
  waitForSelectorCalls: Array<{ selector: string; timeout?: number }>;
  waitForNetworkIdleCalls: Array<{ timeout?: number }>;
} {
  const ctx = new RunContext('test', logger);
  const waitForSelectorCalls: Array<{ selector: string; timeout?: number }> = [];
  const waitForNetworkIdleCalls: Array<{ timeout?: number }> = [];

  const pageService: any = {
    waitForSelector: async (selector: string, timeout?: number) => {
      waitForSelectorCalls.push({ selector, timeout });
      if (opts.waitForSelectorImpl) return opts.waitForSelectorImpl(selector, timeout);
    },
    waitForNavigation: async (urlPattern?: string, timeout?: number) => {
      if (opts.waitForNavigationImpl) return opts.waitForNavigationImpl(urlPattern, timeout);
    },
    waitForNetworkIdle: async (timeout?: number) => {
      waitForNetworkIdleCalls.push({ timeout });
      if (opts.waitForNetworkIdleImpl) return opts.waitForNetworkIdleImpl(timeout);
    },
    delay: async (ms: number) => {
      if (opts.delayImpl) return opts.delayImpl(ms);
    },
    elementExists: async () => false,
    getUrl: async () => 'https://example.test/',
    getHtml: async () => '<html></html>',
  };

  const elementResolver: any = { resolve: async () => ({ selector: 'x', source: 'primary' }) };
  const browserService: any = { screenshot: async () => 'noop' };
  const contextCapture: any = { capture: async () => ({ url: '', title: '', html: '' }) };
  const llmService: any = { evaluateCondition: async () => ({ result: false }) };
  const tools = new Map();
  const functions = new Map();

  const exec = new StepExecutor(
    pageService,
    elementResolver,
    tools,
    ctx,
    browserService,
    false,
    contextCapture,
    llmService,
    functions,
  );

  return { exec, ctx, waitForSelectorCalls, waitForNetworkIdleCalls };
}

function waitStep(
  condition: 'selector' | 'navigation' | 'delay' | 'network_idle',
  overrides: {
    value?: string;
    actionTimeout?: number;
    stepTimeout: number;
  },
): Step {
  return {
    id: 'step-wait',
    name: 'wait test',
    type: 'wait',
    action: {
      condition,
      value: overrides.value,
      timeout: overrides.actionTimeout,
    } as Step['action'],
    onFailure: 'abort',
    maxRetries: 0,
    timeout: overrides.stepTimeout,
  };
}

describe('StepExecutor · executeWait — timeout fallback', () => {
  it('plumbs step.timeout through to waitForSelector when action.timeout is absent', async () => {
    const env = buildExec();
    const step = waitStep('selector', { value: '#target', stepTimeout: 60000 });

    await env.exec.execute(step);

    expect(env.waitForSelectorCalls).toHaveLength(1);
    expect(env.waitForSelectorCalls[0].timeout).toBe(60000);
  });

  it('prefers action.timeout over step.timeout when both are set', async () => {
    const env = buildExec();
    const step = waitStep('selector', {
      value: '#target',
      actionTimeout: 15000,
      stepTimeout: 60000,
    });

    await env.exec.execute(step);

    expect(env.waitForSelectorCalls[0].timeout).toBe(15000);
  });

  it('plumbs step.timeout through to waitForNetworkIdle', async () => {
    const env = buildExec();
    const step = waitStep('network_idle', { stepTimeout: 45000 });

    await env.exec.execute(step);

    expect(env.waitForNetworkIdleCalls[0].timeout).toBe(45000);
  });
});

describe('StepExecutor · runWithStepTimeout — race wrapper', () => {
  it('aborts a hung wait step with a clear error when step.timeout fires', async () => {
    vi.useFakeTimers();
    try {
      // waitForSelector never resolves — the race wrapper should fire.
      const env = buildExec({
        waitForSelectorImpl: () => new Promise<void>(() => {}),
      });
      const step = waitStep('selector', { value: '#target', stepTimeout: 5000 });

      const promise = env.exec.execute(step);
      const rejection = expect(promise).rejects.toThrow(
        /exceeded step timeout of 5000ms/,
      );

      // Advance past the step timeout to trip the setTimeout branch.
      await vi.advanceTimersByTimeAsync(5001);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wrap composite step types — an aiscope step with timeout=1 still runs its own budget', async () => {
    // A bare aiscope step with timeout=1 (ms) would be aborted
    // instantly if the wrapper applied. Instead we expect the inner
    // agent loop to run and surface its own iteration-budget error.
    vi.useFakeTimers();
    try {
      const env = buildExec();
      const step: Step = {
        id: 'step-aiscope',
        name: 'aiscope test',
        type: 'aiscope',
        action: {
          goal: 'test',
          successCheck: { check: 'element_exists', value: '#never' },
          maxDurationSec: 300,
          maxIterations: 1,
          includeScreenshot: false,
        } as Step['action'],
        onFailure: 'abort',
        maxRetries: 0,
        timeout: 1, // would instantly trip the wrapper — must be ignored
      };

      // The wrapper should be skipped, so execution enters the aiscope
      // loop. The mocked llmService.decideNextAction is not configured,
      // so the loop will either call the default stub or exhaust after
      // one iteration. We only assert the error message is about the
      // aiscope budget, not the step.timeout wrapper.
      const stubbedLlm: any = {
        evaluateCondition: async () => ({ result: false }),
        decideNextAction: async () => ({ action: 'done', reasoning: 'stub' }),
      };
      // Replace the llmService via a fresh executor — the buildExec
      // helper's stub doesn't define decideNextAction.
      const ctx = new RunContext('test', logger);
      const pageService: any = {
        elementExists: async () => false,
        getUrl: async () => 'https://example.test/',
        getHtml: async () => '<html></html>',
      };
      const contextCapture: any = { capture: async () => ({ url: '', title: '', html: '' }) };
      const browserService: any = { screenshot: async () => 'noop' };
      const elementResolver: any = { resolve: async () => ({}) };
      const exec = new StepExecutor(
        pageService,
        elementResolver,
        new Map(),
        ctx,
        browserService,
        false,
        contextCapture,
        stubbedLlm,
        new Map(),
      );

      const runP = exec.execute(step);
      // No wrapper timer active, so we don't advance fake timers.
      const rejection = expect(runP).rejects.toThrow(/1-iteration budget/);
      await rejection;
      // And critically: the error must NOT mention the step-timeout wrapper.
      void env;
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the wrapper when step.timeout is 0', async () => {
    // A delay of 50ms with step.timeout=0 must succeed rather than
    // trip a zero-length race.
    const env = buildExec({
      delayImpl: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    });
    const step: Step = {
      id: 'step-wait',
      name: 'wait test',
      type: 'wait',
      action: { condition: 'delay', value: '50' } as Step['action'],
      onFailure: 'abort',
      maxRetries: 0,
      timeout: 0,
    };

    await expect(env.exec.execute(step)).resolves.toBeUndefined();
  });
});
