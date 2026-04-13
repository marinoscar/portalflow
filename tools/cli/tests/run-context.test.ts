import { describe, it, expect } from 'vitest';
import { RunContext } from '../src/runner/run-context.js';
import pino from 'pino';

// Silent logger for tests
const logger = pino({ level: 'silent' });

describe('RunContext.resolveTemplate', () => {
  const newContext = () => new RunContext('test', logger);

  it('substitutes a known variable', () => {
    const ctx = newContext();
    ctx.setVariable('name', 'alice');
    expect(ctx.resolveTemplate('hello {{name}}')).toBe('hello alice');
  });

  it('leaves unknown variables as literal template text', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('hello {{name}}')).toBe('hello {{name}}');
  });

  it('falls back to default value when variable is unset', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('count: {{billCount:3}}')).toBe('count: 3');
  });

  it('uses variable value when set, ignoring the default', () => {
    const ctx = newContext();
    ctx.setVariable('billCount', '5');
    expect(ctx.resolveTemplate('count: {{billCount:3}}')).toBe('count: 5');
  });

  it('preserves colons in default values (URL case)', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{url:http://localhost:3000/api}}')).toBe('http://localhost:3000/api');
  });

  it('handles empty default as empty string', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('[{{foo:}}]')).toBe('[]');
  });

  it('does not trim whitespace in the default', () => {
    const ctx = newContext();
    expect(ctx.resolveTemplate('{{greeting: hello }}')).toBe(' hello ');
  });

  it('handles multiple templates in one string', () => {
    const ctx = newContext();
    ctx.setVariable('a', 'first');
    expect(ctx.resolveTemplate('{{a}} and {{b:second}}')).toBe('first and second');
  });
});
