import { describe, it, expect, vi } from 'vitest';
import { SmscliAdapter } from '../smscli.adapter.js';
import { VaultcliAdapter } from '../vaultcli.adapter.js';
import type { ToolExecutor } from '../tool-executor.js';

// We only call describe() — no subprocess interaction needed.
function makeExecutor(): ToolExecutor {
  return { run: vi.fn() } as unknown as ToolExecutor;
}

describe('SmscliAdapter.describe()', () => {
  const adapter = new SmscliAdapter(makeExecutor());
  const desc = adapter.describe();

  it('tool name is smscli', () => {
    expect(desc.tool).toBe('smscli');
  });

  it('description is non-empty', () => {
    expect(desc.description.length).toBeGreaterThan(0);
  });

  it('exposes exactly three commands', () => {
    const names = desc.commands.map((c) => c.command);
    expect(names).toHaveLength(3);
    expect(names).toContain('otp-wait');
    expect(names).toContain('otp-latest');
    expect(names).toContain('otp-extract');
  });

  it('otp-wait advertises exactly one arg: timeout (not required)', () => {
    const cmd = desc.commands.find((c) => c.command === 'otp-wait')!;
    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0]!.name).toBe('timeout');
    expect(cmd.args[0]!.required).toBe(false);
  });

  it('otp-latest advertises zero args', () => {
    const cmd = desc.commands.find((c) => c.command === 'otp-latest')!;
    expect(cmd.args).toHaveLength(0);
  });

  it('otp-extract advertises exactly one arg: message (required)', () => {
    const cmd = desc.commands.find((c) => c.command === 'otp-extract')!;
    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0]!.name).toBe('message');
    expect(cmd.args[0]!.required).toBe(true);
  });

  it('all command resultDescriptions are non-empty', () => {
    for (const cmd of desc.commands) {
      expect(cmd.resultDescription.length).toBeGreaterThan(0);
    }
  });

  // Explicit negative assertion: narrow surface must not leak runtime-only args
  it('does not advertise sender, number, since, or device in any command', () => {
    const allArgNames = desc.commands.flatMap((c) => c.args.map((a) => a.name));
    expect(allArgNames).not.toContain('sender');
    expect(allArgNames).not.toContain('number');
    expect(allArgNames).not.toContain('since');
    expect(allArgNames).not.toContain('device');
  });

  it('does not mention sender/number/since/device in command descriptions', () => {
    const allText = desc.commands
      .flatMap((c) => [c.description, c.resultDescription, ...c.args.map((a) => a.description)])
      .join(' ');
    // These are runtime-plumbing args that should stay invisible to the LLM
    expect(allText).not.toMatch(/\bsender\b/i);
    expect(allText).not.toMatch(/\bnumber\b/i);
    expect(allText).not.toMatch(/\bsince\b/i);
    expect(allText).not.toMatch(/\bdevice\b/i);
  });
});

describe('VaultcliAdapter.describe()', () => {
  const adapter = new VaultcliAdapter(makeExecutor());
  const desc = adapter.describe();

  it('tool name is vaultcli', () => {
    expect(desc.tool).toBe('vaultcli');
  });

  it('description is non-empty', () => {
    expect(desc.description.length).toBeGreaterThan(0);
  });

  it('exposes exactly one command: secrets-get', () => {
    expect(desc.commands).toHaveLength(1);
    expect(desc.commands[0]!.command).toBe('secrets-get');
  });

  it('secrets-get has name (required) and field (not required)', () => {
    const cmd = desc.commands[0]!;
    const nameArg = cmd.args.find((a) => a.name === 'name');
    const fieldArg = cmd.args.find((a) => a.name === 'field');
    expect(nameArg).toBeDefined();
    expect(nameArg!.required).toBe(true);
    expect(fieldArg).toBeDefined();
    expect(fieldArg!.required).toBe(false);
  });

  it('resultDescription is non-empty', () => {
    expect(desc.commands[0]!.resultDescription.length).toBeGreaterThan(0);
  });
});
