import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import pino from 'pino';
import { ExtensionHost, ExtensionCommandError } from '../extension-host.js';
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

    await expect(
      host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-after-close',
        timeoutMs: 5000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      }),
    ).rejects.toThrow('Extension not connected');
  });
});
