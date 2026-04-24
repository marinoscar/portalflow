import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSchemaCommand } from '../schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spy on process.stdout.write, call fn(), collect all written chunks as a
 * single string, then restore the spy.
 */
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// runSchemaCommand — compact (default)
// ---------------------------------------------------------------------------

describe('runSchemaCommand — compact output', () => {
  it('writes output that parses as valid JSON', () => {
    const output = captureStdout(() => runSchemaCommand({}));
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('the parsed output contains definitions.Automation.properties.steps', () => {
    const output = captureStdout(() => runSchemaCommand({}));
    const schema = JSON.parse(output) as Record<string, unknown>;
    const definitions = schema['definitions'] as Record<string, unknown> | undefined;
    expect(definitions).toBeDefined();
    const automation = definitions!['Automation'] as Record<string, unknown> | undefined;
    expect(automation).toBeDefined();
    const properties = automation!['properties'] as Record<string, unknown> | undefined;
    expect(properties).toBeDefined();
    expect(properties!['steps']).toBeDefined();
  });

  it('output is a single line (no internal newlines except the trailing one)', () => {
    const output = captureStdout(() => runSchemaCommand({}));
    // Strip the trailing newline, then assert no remaining newlines.
    const withoutTrailing = output.endsWith('\n') ? output.slice(0, -1) : output;
    expect(withoutTrailing).not.toContain('\n');
  });

  it('ends with a trailing newline', () => {
    const output = captureStdout(() => runSchemaCommand({}));
    expect(output.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runSchemaCommand — pretty
// ---------------------------------------------------------------------------

describe('runSchemaCommand — pretty output', () => {
  it('writes output that parses as valid JSON', () => {
    const output = captureStdout(() => runSchemaCommand({ pretty: true }));
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('produces multi-line output (contains internal newlines)', () => {
    const output = captureStdout(() => runSchemaCommand({ pretty: true }));
    // Pretty-printed JSON always has multiple lines.
    const withoutTrailing = output.endsWith('\n') ? output.slice(0, -1) : output;
    expect(withoutTrailing).toContain('\n');
  });

  it('the parsed pretty output contains the same schema as compact', () => {
    const compact = captureStdout(() => runSchemaCommand({}));
    const pretty = captureStdout(() => runSchemaCommand({ pretty: true }));
    expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
  });
});
