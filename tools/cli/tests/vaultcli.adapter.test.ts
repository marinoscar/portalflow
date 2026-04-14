import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultcliAdapter } from '../src/tools/vaultcli.adapter.js';
import type { ToolExecutor, RunResult } from '../src/tools/tool-executor.js';

type RunFn = (
  binary: string,
  args: string[],
  options?: unknown,
) => Promise<RunResult>;

function makeExecutor(run: RunFn): ToolExecutor {
  return { run } as unknown as ToolExecutor;
}

function ok(json: unknown): RunResult {
  return { stdout: JSON.stringify(json), stderr: '', exitCode: 0 };
}

describe('VaultcliAdapter', () => {
  let runMock: ReturnType<typeof vi.fn>;
  let adapter: VaultcliAdapter;

  beforeEach(() => {
    runMock = vi.fn();
    adapter = new VaultcliAdapter(makeExecutor(runMock as unknown as RunFn));
  });

  it('calls `vaultcli secrets get <name> --json` and returns multi-field result', async () => {
    runMock.mockResolvedValueOnce(
      ok({
        success: true,
        data: {
          id: '58638e0d-1038-4e8b-b842-8816598ab601',
          name: 'att',
          updatedAt: '2026-04-14T02:04:41.159Z',
          values: {
            username: 'oscar@marin.cr',
            password: 'M27121983s',
            url: 'https://att.com',
          },
        },
      }),
    );

    const result = await adapter.execute('secrets-get', { name: 'att' });

    expect(runMock).toHaveBeenCalledWith('vaultcli', ['secrets', 'get', 'att', '--json'], undefined);
    expect(result.success).toBe(true);
    expect(result.fields).toEqual({
      username: 'oscar@marin.cr',
      password: 'M27121983s',
      url: 'https://att.com',
    });
    // output is the JSON-stringified values map
    expect(JSON.parse(result.output)).toEqual(result.fields);
  });

  it('returns just the requested field when "field" arg is set', async () => {
    runMock.mockResolvedValueOnce(
      ok({
        success: true,
        data: {
          name: 'att',
          values: { username: 'oscar@marin.cr', password: 'M27121983s' },
        },
      }),
    );

    const result = await adapter.execute('secrets-get', { name: 'att', field: 'password' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('M27121983s');
    expect(result.fields).toBeUndefined();
  });

  it('errors when the requested field is missing from the secret', async () => {
    runMock.mockResolvedValueOnce(
      ok({
        success: true,
        data: { name: 'att', values: { username: 'oscar@marin.cr' } },
      }),
    );

    const result = await adapter.execute('secrets-get', { name: 'att', field: 'password' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('field "password"');
    expect(result.error).toContain('Available: username');
  });

  it('surfaces vaultcli envelope errors with code', async () => {
    runMock.mockResolvedValueOnce(
      ok({ success: false, error: 'Secret not found', code: 'NOT_FOUND' }),
    );

    const result = await adapter.execute('secrets-get', { name: 'missing' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Secret not found');
    expect(result.error).toContain('NOT_FOUND');
  });

  it('errors when stdout is not valid JSON', async () => {
    runMock.mockResolvedValueOnce({ stdout: 'not json', stderr: 'bad', exitCode: 2 });

    const result = await adapter.execute('secrets-get', { name: 'att' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects unknown commands without invoking the binary', async () => {
    const result = await adapter.execute('list', { name: 'att' });

    expect(runMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown vaultcli command');
  });

  it('rejects missing name arg without invoking the binary', async () => {
    const result = await adapter.execute('secrets-get', {});

    expect(runMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires');
    expect(result.error).toContain('name');
  });

  it('accepts legacy `get` as an alias for `secrets-get`', async () => {
    runMock.mockResolvedValueOnce(
      ok({ success: true, data: { values: { username: 'alice' } } }),
    );

    const result = await adapter.execute('get', { name: 'alice-creds' });

    expect(runMock).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.fields).toEqual({ username: 'alice' });
  });
});
