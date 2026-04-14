import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { RunContext } from '../src/runner/run-context.js';

const logger = pino({ level: 'silent' });
const newContext = () => new RunContext('test', logger);

describe('RunContext.recordStepOutcome', () => {
  it('writes success variables for a passing step', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-1', 'success');
    expect(ctx.getVariable('step-1_status')).toBe('success');
    expect(ctx.getVariable('step-1_error')).toBe('');
    expect(ctx.getVariable('last_step_id')).toBe('step-1');
    expect(ctx.getVariable('last_step_status')).toBe('success');
    expect(ctx.getVariable('last_step_error')).toBe('');
  });

  it('writes failed variables with the error message', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-2', 'failed', 'Element not found: #login');
    expect(ctx.getVariable('step-2_status')).toBe('failed');
    expect(ctx.getVariable('step-2_error')).toBe('Element not found: #login');
    expect(ctx.getVariable('last_step_status')).toBe('failed');
    expect(ctx.getVariable('last_step_error')).toBe('Element not found: #login');
  });

  it('writes skipped status with the error that caused the skip', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-3', 'skipped', 'Timeout waiting for selector');
    expect(ctx.getVariable('step-3_status')).toBe('skipped');
    // Skipped steps preserve the error under <stepId>_error for visibility,
    // but `last_step_error` is only set when status === 'failed'. Skipped
    // steps get an empty last_step_error so "did the previous step fail?"
    // checks using last_step_status === "failed" work cleanly.
    expect(ctx.getVariable('last_step_status')).toBe('skipped');
    expect(ctx.getVariable('last_step_error')).toBe('');
  });

  it('rolls forward the last_step_* pointers across multiple calls', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-1', 'success');
    expect(ctx.getVariable('last_step_id')).toBe('step-1');

    ctx.recordStepOutcome('step-2', 'failed', 'boom');
    expect(ctx.getVariable('last_step_id')).toBe('step-2');
    expect(ctx.getVariable('last_step_status')).toBe('failed');
    expect(ctx.getVariable('last_step_error')).toBe('boom');

    // step-1's per-step vars are still present — rolling forward the
    // shared pointers does not erase the step-keyed history.
    expect(ctx.getVariable('step-1_status')).toBe('success');
    expect(ctx.getVariable('step-1_error')).toBe('');

    ctx.recordStepOutcome('step-3', 'success');
    expect(ctx.getVariable('last_step_id')).toBe('step-3');
    expect(ctx.getVariable('last_step_status')).toBe('success');
    expect(ctx.getVariable('last_step_error')).toBe('');
    // step-2's failure history is still accessible via the step-keyed vars
    expect(ctx.getVariable('step-2_status')).toBe('failed');
    expect(ctx.getVariable('step-2_error')).toBe('boom');
  });
});

describe('$lastStep* system functions', () => {
  it('default to safe values before any step has run', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{$lastStepStatus}}')).toBe('none');
    expect(ctx.resolveTemplate('{{$lastStepError}}')).toBe('');
    expect(ctx.resolveTemplate('{{$lastStepId}}')).toBe('');
  });

  it('reflect the most recent step outcome', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-login', 'failed', 'invalid credentials');
    expect(ctx.resolveTemplate('{{$lastStepId}}')).toBe('step-login');
    expect(ctx.resolveTemplate('{{$lastStepStatus}}')).toBe('failed');
    expect(ctx.resolveTemplate('{{$lastStepError}}')).toBe('invalid credentials');
  });

  it('update live as new steps settle', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-1', 'success');
    expect(ctx.resolveTemplate('{{$lastStepStatus}}')).toBe('success');
    ctx.recordStepOutcome('step-2', 'failed', 'network');
    expect(ctx.resolveTemplate('{{$lastStepStatus}}')).toBe('failed');
    expect(ctx.resolveTemplate('{{$lastStepError}}')).toBe('network');
  });

  it('compose with other templates in the same string', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-flaky', 'failed', 'timeout');
    const resolved = ctx.resolveTemplate(
      'Recovery: {{$lastStepId}} -> {{$lastStepStatus}} ({{$lastStepError}})',
    );
    expect(resolved).toBe('Recovery: step-flaky -> failed (timeout)');
  });
});

describe('variable_equals pattern for condition checks', () => {
  it('supports the "did previous step fail?" check via last_step_status variable', () => {
    const ctx = newContext();
    ctx.recordStepOutcome('step-1', 'failed', 'boom');

    // This is exactly what condition.check = "variable_equals" evaluates
    // at runtime: the value field is parsed as `name=expected` and the
    // runtime tests `context.getVariable(name) === expected`.
    const parts = 'last_step_status=failed'.split('=');
    const varName = parts[0]!;
    const expected = parts[1]!;
    expect(ctx.getVariable(varName)).toBe(expected);
  });
});
