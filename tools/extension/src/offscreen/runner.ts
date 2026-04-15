import type { RunnerCommand, RunnerResponse, RunnerSession, RunnerEvent } from '../shared/runner-protocol';
import { RUNNER_PROTOCOL_VERSION } from '../shared/runner-protocol';

const WS_URL = 'ws://127.0.0.1:7667';
const PREFIX = '[portalflow-runner]';

// Backoff constants
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 16_000;
const BACKOFF_JITTER = 0.25;

function log(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

function parseChromeVersion(): string {
  const match = navigator.userAgent.match(/Chrome\/([\d.]+)/);
  return match ? match[1] : 'unknown';
}

function computeBackoff(attempt: number): number {
  const base = Math.min(BACKOFF_INITIAL_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
  const jitter = base * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

let currentSocket: WebSocket | null = null;

function connect(attempt = 0): void {
  log('connecting', { url: WS_URL, attempt });

  const ws = new WebSocket(WS_URL);
  currentSocket = ws;
  let sessionReceived = false;

  ws.addEventListener('open', () => {
    log('open');

    const manifest = chrome.runtime.getManifest();
    const helloMsg = {
      kind: 'event' as const,
      type: 'hello' as const,
      chromeVersion: parseChromeVersion(),
      extensionVersion: manifest.version,
      protocolVersion: RUNNER_PROTOCOL_VERSION,
    };
    ws.send(JSON.stringify(helloMsg));
    log('hello_sent', helloMsg);
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    let data: unknown;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      log('parse_error', event.data);
      return;
    }

    // Session handshake — first message from server
    if (!sessionReceived) {
      const session = data as RunnerSession;
      if (session.kind === 'session') {
        sessionReceived = true;
        log('session_received', { runId: session.runId, protocolVersion: session.protocolVersion });
      } else {
        log('unexpected_before_session', data);
      }
      return;
    }

    // Command dispatch
    const command = data as RunnerCommand;
    log('command_received', { type: command.type, commandId: command.commandId });

    // Forward to service worker and send reply back on the socket
    chrome.runtime.sendMessage({ channel: 'runner', command }, (response: RunnerResponse) => {
      if (chrome.runtime.lastError) {
        log('sendMessage_error', chrome.runtime.lastError.message);
        return;
      }
      ws.send(JSON.stringify(response));
      log('response_sent', { commandId: command.commandId, ok: response.ok });
    });
  });

  ws.addEventListener('error', (event) => {
    log('error', event);
  });

  ws.addEventListener('close', (event) => {
    log('close', { code: event.code, reason: event.reason });
    currentSocket = null;
    sessionReceived = false;

    const delayMs = computeBackoff(attempt);
    log('reconnect_scheduled', { delayMs, nextAttempt: attempt + 1 });
    setTimeout(() => connect(attempt + 1), delayMs);
  });
}

window.addEventListener('beforeunload', () => {
  if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
    currentSocket.close(1000, 'offscreen unloading');
  }
});

// ---------------------------------------------------------------------------
// Unsolicited event bridge: service worker → offscreen → CLI over WebSocket
// ---------------------------------------------------------------------------

/**
 * The service worker (background) cannot hold an open WebSocket, so when it
 * needs to send an unsolicited event (e.g. windowClosed / tabClosed) it posts
 * a runtime message here and we forward it on the current WebSocket.
 */
chrome.runtime.onMessage.addListener(
  (msg: { channel?: string; event?: RunnerEvent }): boolean => {
    if (msg.channel !== 'runner-event' || !msg.event) {
      return false; // not our message
    }

    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      currentSocket.send(JSON.stringify(msg.event));
      log('forwarded_runner_event', { type: msg.event.type });
    } else {
      log('runner_event_dropped_no_socket', { type: msg.event.type });
    }

    return false; // synchronous — no sendResponse needed
  },
);

// Start connecting immediately
connect();
