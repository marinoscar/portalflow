import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import pino from 'pino';
import { ExtensionHost, ExtensionCommandError, RECONNECT_WINDOW_MS } from '../extension-host.js';
import { RUNNER_PROTOCOL_VERSION } from '../protocol.js';
import type { RunnerResult, RunnerError } from '../protocol.js';

const logger = pino({ level: 'silent' });

/** Build a valid hello event matching the protocol. */
function helloEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'event',
    type: 'hello',
    chromeVersion: '120.0',
    extensionVersion: '1.0.0',
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    ...overrides,
  };
}

/** Connect a WS client to the given port and perform the handshake. Returns the client and the session message. */
async function connectAndHandshake(
  port: number,
): Promise<{ client: WebSocket; session: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    client.on('error', reject);
    client.once('open', () => {
      client.send(JSON.stringify(helloEvent()));
      client.once('message', (data) => {
        const session = JSON.parse(data.toString()) as Record<string, unknown>;
        resolve({ client, session });
      });
    });
  });
}

describe('ExtensionHost', () => {
  let host: ExtensionHost;

  afterEach(async () => {
    if (host) {
      await host.close().catch(() => undefined);
    }
  });

  it('starts on an ephemeral port (port 0) and resolves with a valid host', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
    expect(host.port).toBeGreaterThan(0);
    expect(host.isConnected()).toBe(false);
  });

  it('client hello → server replies with session → isConnected() true and connected event fires', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const connectedFired = new Promise<void>((resolve) => {
      host.once('connected', resolve);
    });

    const { client, session } = await connectAndHandshake(host.port);

    await connectedFired;

    expect(host.isConnected()).toBe(true);
    expect(session['kind']).toBe('session');
    expect(session['protocolVersion']).toBe(RUNNER_PROTOCOL_VERSION);
    expect(typeof session['runId']).toBe('string');

    client.close();
  });

  it('wrong-version hello → server closes with code 1002', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${host.port}`);
      client.on('error', reject);
      client.once('open', () => {
        client.send(JSON.stringify(helloEvent({ protocolVersion: '1' })));
      });
      client.once('close', (code) => {
        try {
          expect(code).toBe(1002);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    expect(host.isConnected()).toBe(false);
  });

  it('non-hello first message → server closes with code 1002', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${host.port}`);
      client.on('error', reject);
      client.once('open', () => {
        client.send(JSON.stringify({ kind: 'result', commandId: 'x', ok: true, value: null }));
      });
      client.once('close', (code) => {
        try {
          expect(code).toBe(1002);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  it('sendCommand before any connection → rejects with "Extension not connected"', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    await expect(
      host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-1',
        timeoutMs: 5000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      }),
    ).rejects.toThrow('Extension not connected');
  });

  it('sendCommand with a valid ok response → resolves with value', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const { client } = await connectAndHandshake(host.port);

    const commandPromise = host.sendCommand<string>({
      type: 'extract',
      commandId: 'cmd-abc',
      timeoutMs: 5000,
      tab: { kind: 'active' },
      target: 'url',
    });

    // Simulate the extension responding.
    const response: RunnerResult<string> = {
      kind: 'result',
      commandId: 'cmd-abc',
      ok: true,
      value: 'https://example.com',
    };

    await new Promise<void>((resolve) => {
      client.once('message', () => {
        client.send(JSON.stringify(response));
        resolve();
      });
    });

    const result = await commandPromise;
    expect(result).toBe('https://example.com');

    client.close();
  });

  it('sendCommand with ok: false response → rejects with ExtensionCommandError carrying right fields', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const { client } = await connectAndHandshake(host.port);

    const commandPromise = host.sendCommand({
      type: 'interact',
      commandId: 'cmd-xyz',
      timeoutMs: 5000,
      tab: { kind: 'active' },
      action: 'click',
      selectors: { primary: '#btn' },
    });

    const errorResponse: RunnerError = {
      kind: 'result',
      commandId: 'cmd-xyz',
      ok: false,
      message: 'element not found',
      recoverable: false,
      code: 'selector_not_found',
    };

    await new Promise<void>((resolve) => {
      client.once('message', () => {
        client.send(JSON.stringify(errorResponse));
        resolve();
      });
    });

    await expect(commandPromise).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ExtensionCommandError);
      const e = err as ExtensionCommandError;
      expect(e.message).toBe('element not found');
      expect(e.code).toBe('selector_not_found');
      expect(e.recoverable).toBe(false);
      expect(e.commandId).toBe('cmd-xyz');
      return true;
    });

    client.close();
  });

  it('sendCommand timeout → rejects with "timed out" message', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const { client } = await connectAndHandshake(host.port);

    // The extension client deliberately never responds.
    const commandPromise = host.sendCommand({
      type: 'navigate',
      commandId: 'cmd-timeout',
      timeoutMs: 100,
      tab: { kind: 'active' },
      url: 'https://slow.example.com',
    });

    // Consume the incoming message so the socket stays open.
    await new Promise<void>((resolve) => client.once('message', () => resolve()));

    await expect(commandPromise).rejects.toThrow('timed out after 100ms');

    client.close();
  }, 5000);

  it('second client replaces first: first closed with 1008, second adopted, connected fires again', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const { client: first } = await connectAndHandshake(host.port);
    expect(host.isConnected()).toBe(true);

    // Track connected events.
    let connectedCount = 0;
    host.on('connected', () => { connectedCount++; });

    const firstClosed = new Promise<number>((resolve) => {
      first.once('close', (code) => resolve(code));
    });

    // Connect a second client.
    const { client: second } = await connectAndHandshake(host.port);

    const firstCloseCode = await firstClosed;
    expect(firstCloseCode).toBe(1008);
    expect(host.isConnected()).toBe(true);
    expect(connectedCount).toBe(1); // fires once for the second connection

    second.close();
  });

  it('close() shuts down the server and further sendCommand rejects', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const { client } = await connectAndHandshake(host.port);
    void client; // not used further

    await host.close();

    // After close(), state is 'aborted' so sendCommand throws the abort message
    // (before it can even check isConnected).
    await expect(
      host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-after-close',
        timeoutMs: 5000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      }),
    ).rejects.toThrow(/Extension disconnected|Extension not connected/);
  });

  // ---------------------------------------------------------------------------
  // Run-window lifecycle helpers
  // ---------------------------------------------------------------------------

  it('openRunWindow — fake extension replies with windowId/tabId → resolves with correct shape', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const { client } = await connectAndHandshake(host.port);

    // Fake extension: respond to the openWindow command with windowId/tabId.
    client.on('message', (data) => {
      const cmd = JSON.parse(data.toString()) as { commandId: string; type: string };
      if (cmd.type === 'openWindow') {
        client.send(
          JSON.stringify({
            kind: 'result',
            commandId: cmd.commandId,
            ok: true,
            value: { windowId: 5, tabId: 42 },
          }),
        );
      }
    });

    const result = await host.openRunWindow(5000);
    expect(result).toEqual({ windowId: 5, tabId: 42 });

    client.close();
  });

  it('closeRunWindow — fake extension replies ok:true → resolves void without throwing', async () => {
    host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

    const { client } = await connectAndHandshake(host.port);

    client.on('message', (data) => {
      const cmd = JSON.parse(data.toString()) as { commandId: string; type: string };
      if (cmd.type === 'closeWindow') {
        client.send(
          JSON.stringify({
            kind: 'result',
            commandId: cmd.commandId,
            ok: true,
            value: null,
          }),
        );
      }
    });

    // Should resolve without throwing.
    await expect(host.closeRunWindow(5, 5000)).resolves.toBeUndefined();

    client.close();
  });

  // ---------------------------------------------------------------------------
  // Reconnect-pending state machine
  // ---------------------------------------------------------------------------

  describe('reconnect-pending state machine', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('mid-step disconnect: sendCommand rejects with abort error, state goes to aborted', async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { client } = await connectAndHandshake(host.port);

      // Send a command but don't reply — it stays pending.
      const commandPromise = host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-mid-step',
        timeoutMs: 30_000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      });

      // Wait until the command is received by the fake extension (so it's in-flight).
      await new Promise<void>((resolve) => client.once('message', () => resolve()));

      // Collect the disconnected reason emitted.
      let disconnectedReason: string | undefined;
      host.once('disconnected', (reason: string) => { disconnectedReason = reason; });

      // Drop the connection while the command is in flight.
      client.close();

      // sendCommand should reject with the mid-step abort error.
      await expect(commandPromise).rejects.toThrow('Extension disconnected mid-step — run aborted');

      // State should be 'aborted'.
      expect(host.getState()).toBe('aborted');
      expect(disconnectedReason).toBe('aborted');
    }, 15_000);

    it('aborted state: subsequent sendCommand rejects immediately', async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { client } = await connectAndHandshake(host.port);

      // Force into aborted state via mid-step disconnect.
      const p = host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-abort-then-send',
        timeoutMs: 30_000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      });
      await new Promise<void>((resolve) => client.once('message', () => resolve()));
      client.close();
      await p.catch(() => undefined); // absorb the error

      // Now another sendCommand should reject immediately with the abort message.
      await expect(
        host.sendCommand({
          type: 'navigate',
          commandId: 'cmd-post-abort',
          timeoutMs: 5000,
          tab: { kind: 'active' },
          url: 'https://example.com',
        }),
      ).rejects.toThrow('Extension disconnected mid-step — run aborted');
    }, 15_000);

    it('between-step disconnect: state goes to reconnect_pending, emits disconnected with reason', async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { client } = await connectAndHandshake(host.port);

      let disconnectedReason: string | undefined;
      host.once('disconnected', (reason: string) => { disconnectedReason = reason; });

      // Drop without any in-flight command (between steps).
      const closed = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      client.close();
      await closed;

      expect(host.getState()).toBe('reconnect_pending');
      expect(disconnectedReason).toBe('reconnect_pending');
    }, 15_000);

    it('reconnect with matching runId within 30s: returns to connected, emits resumed, session carries resumeFromStep', async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { client, session } = await connectAndHandshake(host.port);
      const runId = session['runId'] as string;

      // Tell the host the resume point (as if the runner completed step 1, resumes at 2).
      host.markResumePoint(runId, 2);

      // Disconnect between steps (no pending commands).
      const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      client.close();
      await disconnected;
      expect(host.getState()).toBe('reconnect_pending');

      // Set up resumed listener.
      const resumedInfo = await new Promise<{ runId: string; resumeFromStep: number }>((resolve) => {
        host.once('resumed', resolve);

        // Reconnect with previousRunId matching the session runId.
        const client2 = new WebSocket(`ws://127.0.0.1:${host.port}`);
        client2.once('open', () => {
          client2.send(JSON.stringify(helloEvent({ previousRunId: runId })));
        });
        client2.once('message', (data) => {
          const resumeSession = JSON.parse(data.toString()) as Record<string, unknown>;
          expect(resumeSession['kind']).toBe('session');
          expect(resumeSession['runId']).toBe(runId);
          expect(resumeSession['resumeFromStep']).toBe(2);
          client2.close();
        });
      });

      expect(resumedInfo.runId).toBe(runId);
      expect(resumedInfo.resumeFromStep).toBe(2);
      expect(host.getState()).toBe('connected');
    }, 15_000);

    it('reconnect with wrong runId: closed with 1008, original state still reconnect_pending', async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { client } = await connectAndHandshake(host.port);

      const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      client.close();
      await disconnected;
      expect(host.getState()).toBe('reconnect_pending');

      // Try to reconnect with the wrong runId.
      await new Promise<void>((resolve, reject) => {
        const intruder = new WebSocket(`ws://127.0.0.1:${host.port}`);
        intruder.on('error', reject);
        intruder.once('open', () => {
          intruder.send(JSON.stringify(helloEvent({ previousRunId: 'wrong-run-id-12345' })));
        });
        intruder.once('close', (code) => {
          try {
            expect(code).toBe(1008);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      // State must still be reconnect_pending (not overridden by the intruder).
      expect(host.getState()).toBe('reconnect_pending');
    }, 15_000);

    it('reconnect timeout after 30s: state goes to aborted, emits reconnectTimeout', async () => {
      vi.useFakeTimers();
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      // Connect, then disconnect between steps.
      const clientConnected = new Promise<{ client: WebSocket }>((resolve, reject) => {
        const c = new WebSocket(`ws://127.0.0.1:${host.port}`);
        c.on('error', reject);
        c.once('open', () => {
          c.send(JSON.stringify(helloEvent()));
          c.once('message', () => resolve({ client: c }));
        });
      });
      // Run fake timers to allow the WS connection to complete.
      // Use real-timer workaround: vitest's fake timers don't affect ws I/O,
      // so we need to flush microtasks with advanceTimersByTime(0).
      vi.advanceTimersByTime(0);
      const { client } = await clientConnected;

      const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      client.close();
      vi.advanceTimersByTime(0);
      await disconnected;
      expect(host.getState()).toBe('reconnect_pending');

      // Subscribe for the timeout event.
      const timeoutFired = new Promise<{ runId: string }>((resolve) => host.once('reconnectTimeout', resolve));

      // Advance past the 30s window.
      vi.advanceTimersByTime(RECONNECT_WINDOW_MS + 1);

      const timeoutInfo = await timeoutFired;
      expect(typeof timeoutInfo.runId).toBe('string');
      expect(host.getState()).toBe('aborted');
    }, 15_000);

    it('close() cancels the reconnect timer and transitions to aborted', async () => {
      vi.useFakeTimers();
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      const clientConnected = new Promise<{ client: WebSocket }>((resolve, reject) => {
        const c = new WebSocket(`ws://127.0.0.1:${host.port}`);
        c.on('error', reject);
        c.once('open', () => {
          c.send(JSON.stringify(helloEvent()));
          c.once('message', () => resolve({ client: c }));
        });
      });
      vi.advanceTimersByTime(0);
      const { client } = await clientConnected;

      const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      client.close();
      vi.advanceTimersByTime(0);
      await disconnected;
      expect(host.getState()).toBe('reconnect_pending');

      // close() should not hang even with a pending reconnect timer.
      // Use real timers for the close() operation.
      vi.useRealTimers();
      await host.close();

      expect(host.getState()).toBe('aborted');
    }, 15_000);

    it('sendCommand during reconnect_pending rejects with "waiting for reconnect" message', async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { client } = await connectAndHandshake(host.port);

      const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      client.close();
      await disconnected;
      expect(host.getState()).toBe('reconnect_pending');

      await expect(
        host.sendCommand({
          type: 'navigate',
          commandId: 'cmd-during-reconnect',
          timeoutMs: 5000,
          tab: { kind: 'active' },
          url: 'https://example.com',
        }),
      ).rejects.toThrow('Extension disconnected — waiting for reconnect');
    }, 15_000);

    it('markResumePoint stores step index used in the next reconnect session', async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { client, session } = await connectAndHandshake(host.port);
      const runId = session['runId'] as string;

      // Mark step 5 as the resume point.
      host.markResumePoint(runId, 5);

      const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      client.close();
      await disconnected;

      const resumeSession = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const c2 = new WebSocket(`ws://127.0.0.1:${host.port}`);
        c2.on('error', reject);
        c2.once('open', () => c2.send(JSON.stringify(helloEvent({ previousRunId: runId }))));
        c2.once('message', (data) => {
          resolve(JSON.parse(data.toString()) as Record<string, unknown>);
          c2.close();
        });
      });

      expect(resumeSession['resumeFromStep']).toBe(5);
    }, 15_000);
  });
});
