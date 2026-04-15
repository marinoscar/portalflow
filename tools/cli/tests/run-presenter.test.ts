import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Step } from '@portalflow/schema';
import { RunPresenter } from '../src/runner/run-presenter.js';
import { defaultLogFilePath } from '../src/runner/logger.js';

/**
 * RunPresenter is a stdout-owning class, so the tests intercept
 * `process.stdout.write` with a spy and assert the lines it would
 * print. The `enabled` flag must fully silence the presenter — every
 * code path under verbose mode is expected to be a no-op so that the
 * pino logger can own stdout without collisions.
 */

function makeStep(overrides: Partial<Step>): Step {
  return {
    id: 'step-1',
    name: 'Test step',
    type: 'navigate',
    action: { url: 'https://example.test/' } as Step['action'],
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 0,
    ...overrides,
  };
}

describe('RunPresenter', () => {
  let writes: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('writes to stdout when enabled', () => {
    const p = new RunPresenter(true, '/tmp/run.log');
    p.runStart('demo automation', 3);
    expect(writes.length).toBeGreaterThan(0);
    const joined = writes.join('');
    expect(joined).toContain('demo automation');
    expect(joined).toContain('3 steps');
  });

  it('is a silent no-op when disabled', () => {
    const p = new RunPresenter(false, '/tmp/run.log');
    p.runStart('demo', 3);
    p.stepStart(makeStep({}), 0, 3);
    p.stepEnd(makeStep({}), 120, 'success');
    p.aiscopeStart('step-1', 10);
    p.aiscopeIteration(1);
    p.aiscopeDecision('click', 'button.x', 'reason');
    p.aiscopeGoalReached(1500, 2);
    p.toolCallStart('smscli', 'otp-wait');
    p.toolCallResult('otp', '123456');
    p.extractResult('order_total', '$42.99');
    p.llmCall(100, 50);
    p.runEnd({
      success: true,
      stepsCompleted: 3,
      stepsTotal: 3,
      errors: [],
      outputs: {},
      artifacts: [],
      startedAt: new Date('2026-04-15T00:00:00Z'),
      completedAt: new Date('2026-04-15T00:00:05Z'),
    });
    p.runFatal(new Error('boom'));
    expect(writes).toEqual([]);
  });

  it('formats the success summary line', () => {
    const p = new RunPresenter(true, '/tmp/run.log');
    p.llmCall(200, 100);
    p.llmCall(300, 150);
    p.runEnd({
      success: true,
      stepsCompleted: 3,
      stepsTotal: 3,
      errors: [],
      outputs: {},
      artifacts: [],
      startedAt: new Date('2026-04-15T00:00:00Z'),
      completedAt: new Date('2026-04-15T00:00:05Z'),
    });
    const out = writes.join('');
    expect(out).toContain('complete');
    expect(out).toContain('3/3 steps');
    expect(out).toContain('5.0s');
    expect(out).toContain('2 LLM calls');
    expect(out).toContain('750 tokens');
    expect(out).toContain('/tmp/run.log');
  });

  it('formats the failure summary line with error list', () => {
    const p = new RunPresenter(true, '/tmp/run.log');
    p.runEnd({
      success: false,
      stepsCompleted: 1,
      stepsTotal: 3,
      errors: [
        { stepId: 'step-2', stepName: 'login', message: 'element not found', at: new Date() },
      ],
      outputs: {},
      artifacts: [],
      startedAt: new Date('2026-04-15T00:00:00Z'),
      completedAt: new Date('2026-04-15T00:00:03Z'),
    });
    const out = writes.join('');
    expect(out).toContain('failed');
    expect(out).toContain('1/3 steps');
    expect(out).toContain('step-2');
    expect(out).toContain('element not found');
  });

  it('shows aiscope decisions with iteration counter', () => {
    const p = new RunPresenter(true, '/tmp/run.log');
    p.aiscopeStart('step-2', 10);
    p.aiscopeIteration(1);
    p.aiscopeDecision('click', 'button#accept', 'visible at top-left');
    const out = writes.join('');
    expect(out).toContain('[1/10]');
    expect(out).toContain('click');
    expect(out).toContain('button#accept');
    expect(out).toContain('visible at top-left');
  });

  it('truncates long reasoning and extract previews', () => {
    const p = new RunPresenter(true, '/tmp/run.log');
    p.extractResult('big', 'x'.repeat(500));
    const out = writes.join('');
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(500);
  });
});

describe('defaultLogFilePath', () => {
  it('slugs the automation name and appends a timestamp', () => {
    const path = defaultLogFilePath('My Demo — Automation!');
    expect(path).toMatch(/\.portalflow\/logs\/my-demo-automation-.*\.log$/);
  });

  it('falls back to "run" for pathological names', () => {
    const path = defaultLogFilePath('!!!!');
    expect(path).toMatch(/\/logs\/run-.*\.log$/);
  });
});
