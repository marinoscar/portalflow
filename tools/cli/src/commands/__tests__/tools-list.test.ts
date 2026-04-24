import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectToolDescriptions, runToolsListCommand } from '../tools-list.js';
import type { ToolDescription } from '../../tools/tool.interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// collectToolDescriptions
// ---------------------------------------------------------------------------

describe('collectToolDescriptions', () => {
  it('returns exactly two entries', () => {
    const descriptions = collectToolDescriptions();
    expect(descriptions).toHaveLength(2);
  });

  it('first entry has tool: "smscli"', () => {
    const descriptions = collectToolDescriptions();
    expect(descriptions[0]!.tool).toBe('smscli');
  });

  it('second entry has tool: "vaultcli"', () => {
    const descriptions = collectToolDescriptions();
    expect(descriptions[1]!.tool).toBe('vaultcli');
  });

  it('smscli entry has a non-empty commands array', () => {
    const descriptions = collectToolDescriptions();
    const smscli = descriptions.find((d: ToolDescription) => d.tool === 'smscli');
    expect(smscli).toBeDefined();
    expect(smscli!.commands.length).toBeGreaterThan(0);
  });

  it('vaultcli entry has a non-empty commands array', () => {
    const descriptions = collectToolDescriptions();
    const vaultcli = descriptions.find((d: ToolDescription) => d.tool === 'vaultcli');
    expect(vaultcli).toBeDefined();
    expect(vaultcli!.commands.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// runToolsListCommand — compact (default)
// ---------------------------------------------------------------------------

describe('runToolsListCommand — compact output', () => {
  it('writes output that parses as valid JSON', () => {
    const output = captureStdout(() => runToolsListCommand({}));
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('the parsed output is an array', () => {
    const output = captureStdout(() => runToolsListCommand({}));
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('produces a single-line output (no internal newlines except the trailing one)', () => {
    const output = captureStdout(() => runToolsListCommand({}));
    const withoutTrailing = output.endsWith('\n') ? output.slice(0, -1) : output;
    expect(withoutTrailing).not.toContain('\n');
  });

  it('ends with a trailing newline', () => {
    const output = captureStdout(() => runToolsListCommand({}));
    expect(output.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runToolsListCommand — pretty
// ---------------------------------------------------------------------------

describe('runToolsListCommand — pretty output', () => {
  it('writes output that parses as valid JSON', () => {
    const output = captureStdout(() => runToolsListCommand({ pretty: true }));
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('produces multi-line output (contains internal newlines)', () => {
    const output = captureStdout(() => runToolsListCommand({ pretty: true }));
    const withoutTrailing = output.endsWith('\n') ? output.slice(0, -1) : output;
    expect(withoutTrailing).toContain('\n');
  });

  it('the parsed pretty output equals the compact output', () => {
    const compact = captureStdout(() => runToolsListCommand({}));
    const pretty = captureStdout(() => runToolsListCommand({ pretty: true }));
    expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
  });
});
