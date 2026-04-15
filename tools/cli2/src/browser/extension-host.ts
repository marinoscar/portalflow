import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type pino from 'pino';
import {
  RUNNER_PROTOCOL_VERSION,
  isRunnerResponse,
  isRunnerEvent,
} from './protocol.js';
import type {
  RunnerCommand,
  RunnerSession,
  RunnerEvent,
  RunnerError,
  OpenWindowCommand,
  CloseWindowCommand,
} from './protocol.js';

// ---------------------------------------------------------------------------
// Typed error for extension command failures
// ---------------------------------------------------------------------------

export class ExtensionCommandError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly recoverable: boolean,
    public readonly commandId: string,
  ) {
    super(message);
    this.name = 'ExtensionCommandError';
  }
}

// ---------------------------------------------------------------------------
// Pending-command tracking
// ---------------------------------------------------------------------------

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  commandId: string;
  type: string;
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// ExtensionHost options
// ---------------------------------------------------------------------------

export interface ExtensionHostOptions {
  host: string;
  port: number;
  logger: pino.Logger;
  runId?: string;
}

// ---------------------------------------------------------------------------
// ExtensionHost — WebSocket server that the Chrome extension connects to
// ---------------------------------------------------------------------------

export class ExtensionHost extends EventEmitter {
  private readonly logger: pino.Logger;
  private readonly wss: WebSocketServer;
  private activeConnection: WebSocket | null = null;
  private readonly pending = new Map<string, PendingCommand>();
  public readonly port: number;
  public activeRunId: string | null;

  private constructor(
    wss: WebSocketServer,
    resolvedPort: number,
    opts: ExtensionHostOptions,
  ) {
    super();
    this.wss = wss;
    this.port = resolvedPort;
    this.logger = opts.logger;
    this.activeRunId = opts.runId ?? null;

    this.wss.on('connection', (ws, req) => {
      const remoteAddress = req.socket.remoteAddress ?? 'unknown';
      this.logger.info({ remoteAddress }, 'extension connected');
      this._handleConnection(ws, remoteAddress);
    });
  }

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  static start(opts: ExtensionHostOptions): Promise<ExtensionHost> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: opts.host, port: opts.port });

      wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`ExtensionHost: port ${opts.port} is already in use`));
        } else {
          reject(err);
        }
      });

      wss.on('listening', () => {
        const addr = wss.address() as AddressInfo;
        const host = new ExtensionHost(wss, addr.port, opts);
        resolve(host);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  private _handleConnection(ws: WebSocket, remoteAddress: string): void {
    // Wait for the first message — it must be a `hello` event.
    ws.once('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        this.logger.error({ remoteAddress }, 'extension sent non-JSON as first message — closing');
        ws.close(1002, 'Expected JSON hello event');
        return;
      }

      const msg = parsed as Record<string, unknown>;

      // Validate hello shape.
      if (msg['kind'] !== 'event' || msg['type'] !== 'hello') {
        this.logger.error(
          { remoteAddress, received: msg },
          'extension first message was not a hello event — closing',
        );
        ws.close(1002, 'Expected hello event as first message');
        return;
      }

      // Validate protocol version.
      const extensionVersion = msg['protocolVersion'] as string | undefined;
      if (extensionVersion !== RUNNER_PROTOCOL_VERSION) {
        this.logger.error(
          { remoteAddress, extensionVersion, runnerVersion: RUNNER_PROTOCOL_VERSION },
          'protocol version mismatch — closing',
        );
        ws.close(
          1002,
          `Protocol version mismatch: extension=${extensionVersion}, runner=${RUNNER_PROTOCOL_VERSION}`,
        );
        return;
      }

      // Replace any existing connection.
      if (this.activeConnection !== null) {
        this.logger.warn(
          { remoteAddress },
          'new extension connection arrived while one is active — replacing old connection',
        );
        const old = this.activeConnection;
        old.close(1008, 'Policy Violation — replaced by newer connection');
        // Reject all pending commands since the old connection is gone.
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Connection replaced by newer extension connection'));
        }
        this.pending.clear();
        this.emit('disconnected');
      }

      this.activeConnection = ws;

      // Send session envelope.
      const session: RunnerSession = {
        kind: 'session',
        runId: this.activeRunId ?? randomUUID(),
        protocolVersion: RUNNER_PROTOCOL_VERSION,
      };
      ws.send(JSON.stringify(session));

      this.logger.info({ remoteAddress, runId: session.runId }, 'session sent to extension');
      this.emit('connected');

      // Handle subsequent messages.
      ws.on('message', (data) => this._handleMessage(data));

      // Handle disconnection.
      ws.on('close', (code, reason) => {
        if (this.activeConnection === ws) {
          this.logger.info(
            { remoteAddress, code, reason: reason.toString() },
            'extension disconnected',
          );
          this.activeConnection = null;

          // Reject all pending commands.
          for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Extension disconnected'));
          }
          this.pending.clear();
          this.emit('disconnected');
        }
      });

      ws.on('error', (err) => {
        this.logger.error({ err, remoteAddress }, 'WebSocket error on extension connection');
      });
    });
  }

  private _handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw!.toString());
    } catch {
      this.logger.warn('received non-JSON message from extension — ignoring');
      return;
    }

    const msg = parsed as Record<string, unknown>;

    if (isRunnerResponse(msg as any)) {
      const response = msg as any as import('./protocol.js').RunnerResponse;
      const pending = this.pending.get(response.commandId);
      if (!pending) {
        this.logger.warn(
          { commandId: response.commandId },
          'received response for unknown commandId — ignoring',
        );
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(response.commandId);

      if (response.ok) {
        pending.resolve((response as import('./protocol.js').RunnerResult).value);
      } else {
        const err = response as RunnerError;
        pending.reject(
          new ExtensionCommandError(
            err.message,
            err.code,
            err.recoverable,
            err.commandId,
          ),
        );
      }
    } else if (isRunnerEvent(msg as any)) {
      const event = msg as any as RunnerEvent;
      // Emit unsolicited events by type name.
      this.emit(event.type, event);
    } else {
      this.logger.warn({ msg }, 'received unrecognized message from extension — ignoring');
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  isConnected(): boolean {
    return this.activeConnection !== null && this.activeConnection.readyState === WebSocket.OPEN;
  }

  async sendCommand<T>(command: RunnerCommand): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('Extension not connected');
    }

    return new Promise<T>((resolve, reject) => {
      const { commandId, timeoutMs } = command as { commandId: string; timeoutMs: number };

      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(
          new Error(
            `Command ${command.type} (${commandId}) timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pending.set(commandId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        commandId,
        type: command.type,
        timeoutMs,
      });

      this.activeConnection!.send(JSON.stringify(command), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(commandId);
          reject(err);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Run-window lifecycle helpers
  // ---------------------------------------------------------------------------

  /**
   * Opens a new dedicated run window in the extension-managed Chrome instance.
   * Returns the windowId and tabId of the new window.
   */
  async openRunWindow(timeoutMs = 30_000): Promise<{ windowId: number; tabId: number }> {
    const command: OpenWindowCommand = {
      type: 'openWindow',
      commandId: randomUUID(),
      timeoutMs,
    };
    return this.sendCommand<{ windowId: number; tabId: number }>(command);
  }

  /**
   * Closes the run window identified by `windowId`.
   * Swallows errors — the window may already be closed.
   */
  async closeRunWindow(windowId: number, timeoutMs = 10_000): Promise<void> {
    const command: CloseWindowCommand = {
      type: 'closeWindow',
      commandId: randomUUID(),
      timeoutMs,
      windowId,
    };
    try {
      await this.sendCommand<null>(command);
    } catch (err) {
      this.logger.warn({ err, windowId }, 'closeRunWindow: command failed (window may already be closed)');
    }
  }

  async close(): Promise<void> {
    if (this.activeConnection) {
      const conn = this.activeConnection;
      this.activeConnection = null;
      conn.close(1000, 'ExtensionHost shutting down');
    }

    // Reject all pending commands.
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('ExtensionHost closed'));
    }
    this.pending.clear();

    return new Promise<void>((resolve, reject) => {
      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
