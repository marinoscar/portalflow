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
  ClearBrowsingDataCommand,
  ClearBrowsingDataRange,
} from './protocol.js';

// ---------------------------------------------------------------------------
// Reconnect-pending state machine constants
// ---------------------------------------------------------------------------

/** Milliseconds the host waits for the extension to reconnect between steps. */
export const RECONNECT_WINDOW_MS = 30_000;

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
// Internal connection state machine
// ---------------------------------------------------------------------------

/**
 * Four-state machine for the host's connection lifecycle:
 *
 * idle            → no active run, fresh hello starts a new session.
 * connected       → active run, a client is holding the WebSocket.
 * reconnect_pending → between-step disconnect; waiting ≤30 s for same runId.
 * aborted         → mid-step disconnect or timeout; run cannot be resumed.
 */
type HostState = 'idle' | 'connected' | 'reconnect_pending' | 'aborted';

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

  // State machine
  private state: HostState = 'idle';

  /**
   * Reconnect window metadata.
   * Populated when we enter `reconnect_pending`; null at all other times.
   */
  private reconnectWindow: {
    runId: string;
    deadline: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  /**
   * The resume point the runner wants the extension to start from on
   * reconnect. Updated via `markResumePoint()` after every successful step.
   */
  private resumePoint: { runId: string; stepIndex: number } | null = null;

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

      // Extract optional reconnect field.
      const previousRunId = msg['previousRunId'] as string | undefined;

      // ---------------------------------------------------------------------------
      // State-machine dispatch on incoming hello
      // ---------------------------------------------------------------------------

      if (this.state === 'reconnect_pending') {
        const window = this.reconnectWindow!;
        if (previousRunId === window.runId) {
          // Matching reconnect — transition back to connected.
          this._acceptReconnect(ws, remoteAddress, window.runId);
        } else {
          // Wrong runId (or no previousRunId) — reject this hello.
          this.logger.warn(
            { remoteAddress, previousRunId, expectedRunId: window.runId },
            'hello during reconnect_pending has wrong runId — closing with 1008',
          );
          ws.close(1008, 'Policy Violation — wrong runId during reconnect window');
        }
        return;
      }

      if (this.state === 'aborted') {
        // Any hello while aborted: accept as a fresh session (new run).
        // The old run is already dead. Transition to idle first, then fall through.
        this._transitionTo('idle');
      }

      // idle / connected → replace any existing connection and start fresh.
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
        this.emit('disconnected', 'replaced');
      }

      this._acceptFreshConnection(ws, remoteAddress);
    });
  }

  /**
   * Accept a brand-new (non-resuming) connection.
   * Assigns a fresh runId and sends the session envelope without `resumeFromStep`.
   */
  private _acceptFreshConnection(ws: WebSocket, remoteAddress: string): void {
    this.activeConnection = ws;
    this._transitionTo('connected');

    const session: RunnerSession = {
      kind: 'session',
      runId: this.activeRunId ?? randomUUID(),
      protocolVersion: RUNNER_PROTOCOL_VERSION,
    };
    this.activeRunId = session.runId;
    ws.send(JSON.stringify(session));

    this.logger.info({ remoteAddress, runId: session.runId }, 'session sent to extension (fresh)');
    this.emit('connected');

    this._wireSocketHandlers(ws, remoteAddress);
  }

  /**
   * Accept a matching reconnect within the reconnect window.
   * Sends the session envelope with `resumeFromStep` and transitions back to connected.
   */
  private _acceptReconnect(ws: WebSocket, remoteAddress: string, runId: string): void {
    // Cancel the 30-second timeout.
    if (this.reconnectWindow) {
      clearTimeout(this.reconnectWindow.timer);
      this.reconnectWindow = null;
    }

    this.activeConnection = ws;
    this._transitionTo('connected');

    const resumeFromStep = this.resumePoint?.runId === runId
      ? this.resumePoint.stepIndex
      : 0;

    const session: RunnerSession = {
      kind: 'session',
      runId,
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      resumeFromStep,
    };
    ws.send(JSON.stringify(session));

    this.logger.info(
      { remoteAddress, runId, resumeFromStep },
      'session sent to extension (resume)',
    );
    this.emit('resumed', { runId, resumeFromStep });

    this._wireSocketHandlers(ws, remoteAddress);
  }

  /**
   * Attach message / close / error handlers to an accepted WebSocket.
   * Called by both _acceptFreshConnection and _acceptReconnect.
   */
  private _wireSocketHandlers(ws: WebSocket, remoteAddress: string): void {
    // Handle subsequent messages.
    ws.on('message', (data) => this._handleMessage(data));

    // Handle disconnection.
    ws.on('close', (code, reason) => {
      if (this.activeConnection !== ws) return;

      this.logger.info(
        { remoteAddress, code, reason: reason.toString() },
        'extension disconnected',
      );
      this.activeConnection = null;

      if (this.state !== 'connected') {
        // Already transitioning — nothing to do.
        return;
      }

      const hasPendingCommand = this.pending.size > 0;

      if (hasPendingCommand) {
        // Mid-step disconnect — abort immediately.
        this.logger.warn({ remoteAddress }, 'mid-step disconnect — aborting run');
        this._rejectAllPending(new Error('Extension disconnected mid-step — run aborted'));
        this._transitionTo('aborted');
        this.emit('disconnected', 'aborted');
      } else {
        // Between-step disconnect — enter reconnect window.
        this.logger.info(
          { remoteAddress, runId: this.activeRunId },
          'between-step disconnect — entering reconnect_pending window',
        );
        this._startReconnectWindow();
        this._transitionTo('reconnect_pending');
        this.emit('disconnected', 'reconnect_pending');
      }
    });

    ws.on('error', (err) => {
      this.logger.error({ err, remoteAddress }, 'WebSocket error on extension connection');
    });
  }

  // ---------------------------------------------------------------------------
  // Reconnect window management
  // ---------------------------------------------------------------------------

  private _startReconnectWindow(): void {
    const runId = this.activeRunId!;
    const deadline = Date.now() + RECONNECT_WINDOW_MS;

    const timer = setTimeout(() => {
      if (this.state !== 'reconnect_pending') return;

      this.logger.warn(
        { runId },
        'extension did not reconnect within 30s — aborting run',
      );
      this.reconnectWindow = null;
      this._transitionTo('aborted');
      this.emit('reconnectTimeout', { runId });
    }, RECONNECT_WINDOW_MS);

    this.reconnectWindow = { runId, deadline, timer };
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  private _transitionTo(next: HostState): void {
    this.logger.debug({ from: this.state, to: next }, 'ExtensionHost state transition');
    this.state = next;
  }

  // ---------------------------------------------------------------------------
  // Pending command rejection
  // ---------------------------------------------------------------------------

  private _rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  // ---------------------------------------------------------------------------
  // Message dispatch
  // ---------------------------------------------------------------------------

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

  /**
   * Returns the current connection state.
   * Exposed for testing and observability.
   */
  getState(): HostState {
    return this.state;
  }

  /**
   * Record the step index the runner wants to resume from on reconnect.
   * Should be called immediately after checkpointing a successful step.
   * The value is passed to the extension via `resumeFromStep` in the next
   * session envelope on reconnect.
   */
  markResumePoint(runId: string, stepIndex: number): void {
    this.resumePoint = { runId, stepIndex };
  }

  async sendCommand<T>(command: RunnerCommand): Promise<T> {
    if (this.state === 'aborted') {
      throw new Error('Extension disconnected mid-step — run aborted');
    }

    if (this.state === 'reconnect_pending') {
      throw new Error('Extension disconnected — waiting for reconnect');
    }

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
   * Clears browsing history and cache for the given time range.
   * A range of 'none' returns immediately without sending any command.
   * Does NOT clear cookies or passwords — those are needed for logged-in sessions.
   */
  async clearBrowsingData(range: ClearBrowsingDataRange, timeoutMs = 30_000): Promise<void> {
    if (range === 'none') return;
    const command: ClearBrowsingDataCommand = {
      commandId: randomUUID(),
      type: 'clearBrowsingData',
      range,
      timeoutMs,
    };
    await this.sendCommand(command);
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
    // Cancel any pending reconnect window.
    if (this.reconnectWindow) {
      clearTimeout(this.reconnectWindow.timer);
      this.reconnectWindow = null;
    }

    if (this.activeConnection) {
      const conn = this.activeConnection;
      this.activeConnection = null;
      conn.close(1000, 'ExtensionHost shutting down');
    }

    // Reject all pending commands.
    this._rejectAllPending(new Error('ExtensionHost closed'));

    this._transitionTo('aborted');

    return new Promise<void>((resolve, reject) => {
      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
