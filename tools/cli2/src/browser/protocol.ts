/**
 * WebSocket message contract between portalflow2 CLI (server) and the PortalFlow extension (client).
 * This file is the CLI side — import it inside `tools/cli2`.
 *
 * Keep `tools/cli2/src/browser/protocol.ts` and
 * `tools/extension/src/shared/runner-protocol.ts` in perfect sync —
 * bump `RUNNER_PROTOCOL_VERSION` on any breaking change.
 */

// IMPORTANT: bump this on any incompatible change
export const RUNNER_PROTOCOL_VERSION = '1';

// ---------------------------------------------------------------------------
// Primitive selector/targeting types
// ---------------------------------------------------------------------------

/** Addresses a tab within the extension-managed run window. */
export type TabSelector =
  | { kind: 'active' }          // the run window's active tab
  | { kind: 'id'; tabId: number };

/**
 * Matches the @portalflow/schema selector shape.
 * NOT imported from there so the extension can use this file without pulling
 * the schema package into its bundle. Must stay in sync with the schema's
 * selector shape manually.
 */
export interface SelectorCascade {
  primary: string;
  fallbacks?: string[];
}

/** Condition type for a wait step. */
export type WaitCondition = 'selector' | 'navigation' | 'delay' | 'network_idle';

/** What to extract from a page or element. */
export type ExtractTarget = 'text' | 'attribute' | 'html' | 'url' | 'title' | 'screenshot';

/** Interaction to perform on an element. */
export type InteractAction = 'click' | 'type' | 'select' | 'check' | 'uncheck' | 'hover' | 'focus';

/** What initiates the download. */
export type DownloadTrigger = 'click' | 'navigation';

/** Severity level for log events emitted by the extension. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

// ---------------------------------------------------------------------------
// Command envelopes (CLI → extension)
// ---------------------------------------------------------------------------

export interface NavigateCommand {
  type: 'navigate';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  url: string;
}

export interface InteractCommand {
  type: 'interact';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  action: InteractAction;
  selectors: SelectorCascade;
  /** Required when action === 'type' or action === 'select'. */
  value?: string;
}

export interface WaitCommand {
  type: 'wait';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  condition: WaitCondition;
  /** Required when condition === 'selector'. */
  selectors?: SelectorCascade;
  /** Optional pattern for condition === 'navigation'. */
  urlPattern?: string;
  /** Required when condition === 'delay', in milliseconds. */
  durationMs?: number;
}

export interface ExtractCommand {
  type: 'extract';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  target: ExtractTarget;
  selectors?: SelectorCascade;
  /** Required when target === 'attribute'. */
  attribute?: string;
}

export interface DownloadCommand {
  type: 'download';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  trigger: DownloadTrigger;
  /** Required when trigger === 'click'. */
  selectors?: SelectorCascade;
  /** Required when trigger === 'navigation'. */
  url?: string;
  /** Absolute path on the host where the downloaded file should be saved. */
  saveDir: string;
  filenameHint?: string;
}

export interface ScreenshotCommand {
  type: 'screenshot';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  /** Absolute path on the host where the screenshot should be saved. */
  saveDir: string;
  filenameHint?: string;
}

export interface CountMatchingCommand {
  type: 'countMatching';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  selectors: SelectorCascade;
}

export interface AnyMatchCommand {
  type: 'anyMatch';
  commandId: string;
  timeoutMs: number;
  tab: TabSelector;
  selectors: SelectorCascade;
}

export interface OpenWindowCommand {
  type: 'openWindow';
  commandId: string;
  timeoutMs: number;
}

export interface CloseWindowCommand {
  type: 'closeWindow';
  commandId: string;
  timeoutMs: number;
  windowId: number;
}

export type RunnerCommand =
  | NavigateCommand
  | InteractCommand
  | WaitCommand
  | ExtractCommand
  | DownloadCommand
  | ScreenshotCommand
  | CountMatchingCommand
  | AnyMatchCommand
  | OpenWindowCommand
  | CloseWindowCommand;

// ---------------------------------------------------------------------------
// Response envelopes (extension → CLI)
// ---------------------------------------------------------------------------

export interface RunnerResult<T = unknown> {
  kind: 'result';
  commandId: string;
  ok: true;
  value: T;
}

export interface RunnerError {
  kind: 'result';
  commandId: string;
  ok: false;
  message: string;
  /** Whether the CLI may safely retry the command. */
  recoverable: boolean;
  /** Machine-readable discriminant, e.g. 'selector_not_found', 'timeout', 'tab_not_found'. */
  code?: string;
}

export type RunnerResponse = RunnerResult | RunnerError;

// ---------------------------------------------------------------------------
// Unsolicited events (extension → CLI)
// ---------------------------------------------------------------------------

export type RunnerEvent =
  | { kind: 'event'; type: 'hello'; chromeVersion: string; extensionVersion: string; protocolVersion: string; existingWindowId?: number }
  | { kind: 'event'; type: 'navigationComplete'; tabId: number; url: string }
  | { kind: 'event'; type: 'downloadComplete'; downloadId: number; filename: string; bytesReceived: number }
  | { kind: 'event'; type: 'tabClosed'; tabId: number }
  | { kind: 'event'; type: 'windowClosed'; windowId: number }
  | { kind: 'event'; type: 'log'; level: LogLevel; message: string; context?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Session handshake (CLI → extension, outside of commands)
// ---------------------------------------------------------------------------

export interface RunnerSession {
  kind: 'session';
  /** UUID identifying the current automation run. */
  runId: string;
  /** Must match the extension's RUNNER_PROTOCOL_VERSION. */
  protocolVersion: string;
  /** Set only on reconnect to resume from a specific step index. */
  resumeFromStep?: number;
}

// ---------------------------------------------------------------------------
// Top-level wire types
// ---------------------------------------------------------------------------

/** Messages sent by the CLI on the WebSocket. */
export type ServerToClient = RunnerCommand | RunnerSession;

/** Messages sent by the extension on the WebSocket. */
export type ClientToServer = RunnerResponse | RunnerEvent;

// ---------------------------------------------------------------------------
// Type guards (convenience helpers for downstream consumers)
// ---------------------------------------------------------------------------

export function isRunnerResponse(msg: ClientToServer): msg is RunnerResponse {
  return (msg as any).kind === 'result';
}

export function isRunnerEvent(msg: ClientToServer): msg is RunnerEvent {
  return (msg as any).kind === 'event';
}
