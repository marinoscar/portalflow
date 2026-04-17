import type { RunnerCommand, RunnerResponse } from '../shared/runner-protocol';
import { notImplemented } from './runner-handlers/stub';
import { handleRunnerCommand as dispatchRunnerCommand } from './runner-handlers/dispatch';

const PREFIX = '[portalflow-runner-bootstrap]';

function log(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------

export async function bootstrapRunner(): Promise<void> {
  try {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) {
      log('offscreen document already exists, skipping creation');
      return;
    }

    // Try WORKERS first (Chrome 116+); fall back to BLOBS for older Chrome.
    try {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/index.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'PortalFlow runtime WebSocket transport to the CLI',
      });
      log('offscreen document created (reason: WORKERS)');
    } catch (workersErr) {
      log('WORKERS reason failed, falling back to BLOBS:', workersErr);
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/index.html',
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'PortalFlow runtime WebSocket transport to the CLI',
      });
      log('offscreen document created (reason: BLOBS)');
    }
  } catch (err) {
    console.error(PREFIX, 'bootstrapRunner failed:', err);
  }
}

export async function teardownRunner(): Promise<void> {
  try {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) {
      await chrome.offscreen.closeDocument();
      log('offscreen document closed');
    }
  } catch (err) {
    console.error(PREFIX, 'teardownRunner failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Command dispatch — delegates to the dispatch table (task 6)
// ---------------------------------------------------------------------------

async function handleRunnerCommand(command: RunnerCommand): Promise<RunnerResponse> {
  return dispatchRunnerCommand(command);
}

// ---------------------------------------------------------------------------
// Message listener: handle messages from the offscreen runner
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    msg: { channel?: string; command?: RunnerCommand },
    _sender,
    sendResponse: (response: RunnerResponse) => void,
  ) => {
    if (msg.channel !== 'runner' || !msg.command) {
      return false; // not our message — let other listeners handle it
    }

    handleRunnerCommand(msg.command)
      .then((response) => sendResponse(response))
      .catch((err) => {
        console.error(PREFIX, 'handleRunnerCommand threw:', err);
        sendResponse(notImplemented(msg.command!.commandId));
      });

    return true; // keep sendResponse async
  },
);

// ---------------------------------------------------------------------------
// Auto-bootstrap on extension lifecycle events
// ---------------------------------------------------------------------------

chrome.runtime.onStartup.addListener(() => {
  log('onStartup — bootstrapping runner');
  bootstrapRunner().catch((err) => console.error(PREFIX, 'onStartup bootstrap failed:', err));
});

chrome.runtime.onInstalled.addListener(() => {
  log('onInstalled — bootstrapping runner');
  bootstrapRunner().catch((err) => console.error(PREFIX, 'onInstalled bootstrap failed:', err));
});
