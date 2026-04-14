import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { RunContext } from '../src/runner/run-context.js';
import { StepExecutor } from '../src/runner/step-executor.js';
import type { Step } from '@portalflow/schema';

const logger = pino({ level: 'silent' });

/**
 * StepExecutor has a wide constructor signature because it's the central
 * dispatcher for every runtime concern. For jump-mechanic unit tests we
 * only need the context and an ElementResolver / BrowserService that
 * never gets called (goto and variable_equals condition checks are
 * entirely context-driven).
 *
 * We deliberately cast most dependencies to `any` because the paths
 * under test (goto + variable_equals condition) never touch them. A
 * test that exercised interact/navigate would need real mocks.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function buildExecutor(context: RunContext): StepExecutor {
  const noop: any = () => {
    throw new Error('unexpected call in jump test');
  };
  const pageServiceStub: any = new Proxy({}, { get: () => noop });
  const elementResolverStub: any = { resolve: noop };
  const browserServiceStub: any = { screenshot: noop };
  const contextCaptureStub: any = { capture: noop };
  const llmServiceStub: any = { evaluateCondition: noop };
  const tools = new Map();
  const functions = new Map();

  return new StepExecutor(
    pageServiceStub,
    elementResolverStub,
    tools,
    context,
    browserServiceStub,
    false, // screenshotOnFailure
    contextCaptureStub,
    llmServiceStub,
    functions,
  );
}

function gotoStep(id: string, targetStepId: string): Step {
  return {
    id,
    name: id,
    type: 'goto',
    action: { targetStepId },
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 1000,
  };
}

function conditionStep(
  id: string,
  variableName: string,
  expected: string,
  thenStep?: string,
  elseStep?: string,
): Step {
  return {
    id,
    name: id,
    type: 'condition',
    action: {
      check: 'variable_equals',
      value: `${variableName}=${expected}`,
      thenStep,
      elseStep,
    } as Step['action'],
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 1000,
  };
}

describe('StepExecutor · goto jumps', () => {
  let ctx: RunContext;
  let exec: StepExecutor;

  beforeEach(() => {
    ctx = new RunContext('test', logger);
    exec = buildExecutor(ctx);
  });

  it('returns a jump outcome with the resolved target when the goto step runs', async () => {
    const step = gotoStep('jump-back', 'step-1');
    const outcome = await exec.executeWithPolicy(step);
    expect(outcome).toEqual({ kind: 'jump', targetStepId: 'step-1' });
  });

  it('resolves the targetStepId through the template resolver', async () => {
    ctx.setVariable('nextStep', 'step-3');
    const step = gotoStep('jump-dynamic', '{{nextStep}}');
    const outcome = await exec.executeWithPolicy(step);
    expect(outcome).toEqual({ kind: 'jump', targetStepId: 'step-3' });
  });

  it('records the goto step itself as a success in the run context', async () => {
    const step = gotoStep('jump-back', 'step-1');
    await exec.executeWithPolicy(step);
    expect(ctx.getVariable('jump-back_status')).toBe('success');
    expect(ctx.getVariable('last_step_id')).toBe('jump-back');
  });

  it('throws when the resolved targetStepId is empty', async () => {
    // Build by hand so we can set a whitespace-only literal
    const step: Step = {
      id: 'bad',
      name: 'bad',
      type: 'goto',
      action: { targetStepId: '   ' },
      onFailure: 'abort',
      maxRetries: 0,
      timeout: 1000,
    };
    const outcome = await exec.executeWithPolicy(step);
    // An empty target throws inside executeGoto, which executeWithPolicy
    // catches and — because onFailure is 'abort' with no retries — turns
    // into an abort outcome. The step is recorded as failed.
    expect(outcome).toBe('abort');
    expect(ctx.getVariable('bad_status')).toBe('failed');
    expect(ctx.getVariable('bad_error')).toContain('empty targetStepId');
  });
});

describe('StepExecutor · condition thenStep / elseStep jumps', () => {
  let ctx: RunContext;
  let exec: StepExecutor;

  beforeEach(() => {
    ctx = new RunContext('test', logger);
    exec = buildExecutor(ctx);
  });

  it('jumps to thenStep when the check evaluates to true', async () => {
    ctx.setVariable('last_step_status', 'failed');
    const step = conditionStep(
      'check-last',
      'last_step_status',
      'failed',
      'step-recover',
      'step-next',
    );
    const outcome = await exec.executeWithPolicy(step);
    expect(outcome).toEqual({ kind: 'jump', targetStepId: 'step-recover' });
  });

  it('jumps to elseStep when the check evaluates to false', async () => {
    ctx.setVariable('last_step_status', 'success');
    const step = conditionStep(
      'check-last',
      'last_step_status',
      'failed',
      'step-recover',
      'step-next',
    );
    const outcome = await exec.executeWithPolicy(step);
    expect(outcome).toEqual({ kind: 'jump', targetStepId: 'step-next' });
  });

  it('returns "continue" when the check is true but no thenStep is set', async () => {
    ctx.setVariable('last_step_status', 'failed');
    const step = conditionStep(
      'check-last',
      'last_step_status',
      'failed',
      undefined,
      undefined,
    );
    const outcome = await exec.executeWithPolicy(step);
    expect(outcome).toBe('continue');
  });

  it('writes the condition result variable for later steps', async () => {
    ctx.setVariable('last_step_status', 'failed');
    const step = conditionStep(
      'check-last',
      'last_step_status',
      'failed',
      'step-recover',
    );
    await exec.executeWithPolicy(step);
    expect(ctx.getVariable('check-last_result')).toBe('true');
  });

  it('resolves thenStep through the template resolver', async () => {
    ctx.setVariable('last_step_status', 'failed');
    ctx.setVariable('recoveryTarget', 'step-3');
    const step: Step = {
      id: 'check-last',
      name: 'check',
      type: 'condition',
      action: {
        check: 'variable_equals',
        value: 'last_step_status=failed',
        thenStep: '{{recoveryTarget}}',
      } as Step['action'],
      onFailure: 'abort',
      maxRetries: 0,
      timeout: 1000,
    };
    const outcome = await exec.executeWithPolicy(step);
    expect(outcome).toEqual({ kind: 'jump', targetStepId: 'step-3' });
  });
});

describe('StepExecutor · pendingJump isolation between consecutive steps', () => {
  it('does not bleed a pending jump from one step to the next', async () => {
    const ctx = new RunContext('test', logger);
    const exec = buildExecutor(ctx);

    // First step: a goto that returns a jump outcome
    const first = gotoStep('a', 'step-1');
    const firstOutcome = await exec.executeWithPolicy(first);
    expect(firstOutcome).toEqual({ kind: 'jump', targetStepId: 'step-1' });

    // Second step: a condition whose check is FALSE and has no elseStep.
    // This step should return 'continue' — not a leftover jump from step a.
    ctx.setVariable('flag', 'nope');
    const second = conditionStep('b', 'flag', 'yes', 'step-recover', undefined);
    const secondOutcome = await exec.executeWithPolicy(second);
    expect(secondOutcome).toBe('continue');
  });
});

/*
 * NOTE: The `automation-runner.ts` top-level loop refactor (step-id index
 * build, MAX_STEP_EXECUTIONS execution cap, jump target resolution against
 * the index, clear error on unknown target) is covered end-to-end by the
 * worked example `tools/cli/examples/retry-with-goto.json` under the plan's
 * Verification section. Unit-testing the loop in isolation would require
 * extracting it out of `run()` and mocking the full browser/LLM chain,
 * which is out of scope for this PR.
 */
