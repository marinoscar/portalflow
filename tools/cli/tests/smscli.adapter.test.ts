import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmscliAdapter } from '../src/tools/smscli.adapter.js';
import type { ToolExecutor, RunResult } from '../src/tools/tool-executor.js';

type RunFn = (
  binary: string,
  args: string[],
  options?: unknown,
) => Promise<RunResult>;

function makeExecutor(run: RunFn): ToolExecutor {
  return { run } as unknown as ToolExecutor;
}

function envelope(payload: unknown): RunResult {
  return { stdout: JSON.stringify(payload), stderr: '', exitCode: 0 };
}

describe('SmscliAdapter', () => {
  let runMock: ReturnType<typeof vi.fn>;
  let adapter: SmscliAdapter;

  beforeEach(() => {
    runMock = vi.fn();
    adapter = new SmscliAdapter(makeExecutor(runMock as unknown as RunFn));
  });

  it('runs `otp wait` with --json --timeout and returns the extracted code', async () => {
    runMock.mockResolvedValueOnce(
      envelope({
        success: true,
        data: {
          code: '483921',
          sender: 'MyBank',
          body: 'Your code is 483921',
          smsTimestamp: '2026-04-14T02:04:41.159Z',
          receivedAt: '2026-04-14T02:04:42.000Z',
          messageId: 'abc',
        },
      }),
    );

    const result = await adapter.execute('otp-wait', { sender: 'MyBank', timeout: '30' });

    expect(runMock).toHaveBeenCalledWith(
      'smscli',
      ['otp', 'wait', '--json', '--timeout', '30', '--sender', 'MyBank'],
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('483921');
  });

  it('falls back to `otp latest` automatically when wait returns OTP_TIMEOUT', async () => {
    runMock
      .mockResolvedValueOnce(
        envelope({ success: false, error: 'No OTP found within timeout', code: 'OTP_TIMEOUT' }),
      )
      .mockResolvedValueOnce(
        envelope({
          success: true,
          data: { code: '112233', sender: 'MyBank' },
        }),
      );

    const result = await adapter.execute('otp-wait', { sender: 'MyBank', timeout: '2' });

    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock.mock.calls[0]![1]).toEqual([
      'otp', 'wait', '--json', '--timeout', '2', '--sender', 'MyBank',
    ]);
    expect(runMock.mock.calls[1]![1]).toEqual([
      'otp', 'latest', '--json', '--sender', 'MyBank',
    ]);
    expect(result.success).toBe(true);
    expect(result.output).toBe('112233');
  });

  it('reports combined error when both wait timeout and latest fail', async () => {
    runMock
      .mockResolvedValueOnce(
        envelope({ success: false, error: 'No OTP found within timeout', code: 'OTP_TIMEOUT' }),
      )
      .mockResolvedValueOnce(
        envelope({ success: false, error: 'Inbox empty', code: 'NO_RESULTS' }),
      );

    const result = await adapter.execute('otp-wait', { timeout: '2' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('otp wait timed out');
    expect(result.error).toContain('Inbox empty');
  });

  it('does NOT fall back on auth/non-timeout wait failures', async () => {
    runMock.mockResolvedValueOnce(
      envelope({ success: false, error: 'Unauthorized', code: 'AUTH_ERROR' }),
    );

    const result = await adapter.execute('otp-wait', {});

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
    expect(result.error).toContain('AUTH_ERROR');
  });

  it('runs `otp latest` directly without a fallback path', async () => {
    runMock.mockResolvedValueOnce(
      envelope({ success: true, data: { code: '998877' } }),
    );

    const result = await adapter.execute('otp-latest', { sender: 'Bank' });

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0]![1]).toEqual(['otp', 'latest', '--json', '--sender', 'Bank']);
    expect(result.success).toBe(true);
    expect(result.output).toBe('998877');
  });

  it('runs `otp extract` on a literal message body', async () => {
    runMock.mockResolvedValueOnce(
      envelope({ success: true, data: { code: '654321' } }),
    );

    const result = await adapter.execute('otp-extract', {
      message: 'Your verification code is 654321',
    });

    expect(runMock).toHaveBeenCalledWith(
      'smscli',
      ['otp', 'extract', '--message', 'Your verification code is 654321', '--json'],
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('654321');
  });

  it('errors on otp-extract without a message arg', async () => {
    const result = await adapter.execute('otp-extract', {});

    expect(runMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('message');
  });

  it('rejects unknown commands', async () => {
    const result = await adapter.execute('get-otp', {});

    expect(runMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown smscli command');
  });

  it('defaults timeout to 60 seconds when not specified', async () => {
    runMock.mockResolvedValueOnce(
      envelope({ success: true, data: { code: '000000' } }),
    );

    await adapter.execute('otp-wait', {});

    expect(runMock.mock.calls[0]![1]).toContain('--timeout');
    const argv = runMock.mock.calls[0]![1] as string[];
    const idx = argv.indexOf('--timeout');
    expect(argv[idx + 1]).toBe('60');
  });
});
