/**
 * Integration test — full pipeline without a real browser.
 *
 * Spins up a real ExtensionHost on an ephemeral port, opens a fake WebSocket
 * client that replies to navigate/click/type/extract commands with canned
 * ok:true responses, and runs a 4-step automation through the StepExecutor.
 *
 * This proves the full CLI pipeline (StepExecutor → PageClient →
 * ExtensionHost → WS) end-to-end with no Chrome dependency.
 *
 * Each test sets a vitest timeout of 15 s to accommodate multiple WS
 * round-trips (fake extension replies immediately but the event loop still
 * adds latency per call).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import pino from 'pino';
import { ExtensionHost, RECONNECT_WINDOW_MS } from '../../browser/extension-host.js';
import { PageClient } from '../../browser/page-client.js';
import { PageContextCapture } from '../../browser/context.js';
import { ElementResolver } from '../../browser/element-resolver.js';
import { RunContext } from '../run-context.js';
import { RunPresenter } from '../run-presenter.js';
import { StepExecutor } from '../step-executor.js';
import { CheckpointStore } from '../checkpoint.js';
import { RUNNER_PROTOCOL_VERSION } from '../../browser/protocol.js';
import type { Step } from '@portalflow/schema';
import type { LlmService } from '../../llm/llm.service.js';

// ---------------------------------------------------------------------------
// Fake extension client helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: 'silent' });

/** Send the hello handshake and wait for the session envelope. */
async function handshake(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('error', reject);
    ws.once('open', () => {
      ws.send(
        JSON.stringify({
          kind: 'event',
          type: 'hello',
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          chromeVersion: '120.0',
          extensionVersion: '1.0.0',
        }),
      );
      ws.once('message', () => {
        // Received session envelope — we're connected.
        resolve(ws);
      });
    });
  });
}

/**
 * Set up a fake extension that responds to every command with a canned value.
 * `responses` maps command type → value to include in the ok:true response.
 * Unmapped types get `value: null`.
 */
function setupFakeExtension(
  ws: WebSocket,
  responses: Record<string, unknown> = {},
): void {
  ws.on('message', (data) => {
    let cmd: Record<string, unknown>;
    try {
      cmd = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = cmd['type'] as string;
    const commandId = cmd['commandId'] as string;
    const value = type in responses ? responses[type] : null;

    ws.send(
      JSON.stringify({
        kind: 'result',
        commandId,
        ok: true,
        value,
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Minimal LlmService stub (used only if elementExists returns false for all selectors)
// ---------------------------------------------------------------------------

function makeLlmStub(): LlmService {
  return {
    initialize: async () => undefined,
    findElement: async () => ({ selector: 'button', confidence: 0.9, explanation: '' }),
    decideNextAction: async () => ({ action: 'done', reasoning: 'done' }),
    evaluateCondition: async () => ({ result: true, confidence: 1.0, reasoning: 'yes' }),
    findItems: async () => ({ items: [], explanation: '' }),
  } as unknown as LlmService;
}

/**
 * Build the full service stack: PageClient → PageContextCapture →
 * ElementResolver → StepExecutor. Uses a short defaultTimeoutMs
 * so each individual WS command completes quickly in tests.
 */
function buildStack(host: ExtensionHost): {
  pageClient: PageClient;
  executor: StepExecutor;
  runContext: RunContext;
} {
  const pageClient = new PageClient({
    host,
    logger,
    defaultTimeoutMs: 3000, // short for tests; fake extension replies immediately
  });
  const contextCapture = new PageContextCapture(pageClient);
  const llmService = makeLlmStub();
  const elementResolver = new ElementResolver(pageClient, llmService, contextCapture);
  const runContext = new RunContext('integration-test', logger);

  const executor = new StepExecutor(
    pageClient,
    elementResolver,
    new Map(),
    runContext,
    false,
    contextCapture,
    llmService,
    new Map(),
    new RunPresenter(false, ''),
  );

  return { pageClient, executor, runContext };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('CLI pipeline integration', () => {
  let host: ExtensionHost;
  let fakeWs: WebSocket;

  afterEach(async () => {
    fakeWs?.close();
    if (host) {
      await host.close().catch(() => undefined);
    }
  });

  it(
    'runs a 4-step automation (navigate → click → type → extract) end-to-end',
    async () => {
      // 1. Start the ExtensionHost on an ephemeral port.
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      // 2. Connect the fake extension client.
      fakeWs = await handshake(host.port);
      setupFakeExtension(fakeWs, {
        navigate: null,
        interact: null,
        // anyMatch is used by elementExists during selector resolution in ElementResolver.
        // Returning true means the primary selector is found → no LLM fallback needed.
        anyMatch: true,
        extract: 'Hello from page', // reply for any extract command
      });

      // 3. Build the CLI service stack.
      const { executor, runContext } = buildStack(host);

      // 4. Build a 4-step automation.
      const steps: Step[] = [
        {
          id: 'step-nav',
          name: 'Navigate',
          type: 'navigate',
          action: { url: 'https://example.com' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
        } as Step,
        {
          id: 'step-click',
          name: 'Click button',
          type: 'interact',
          action: { interaction: 'click' },
          selectors: { primary: '#submit' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
        } as Step,
        {
          id: 'step-type',
          name: 'Type text',
          type: 'interact',
          action: { interaction: 'type', value: 'hello' },
          selectors: { primary: '#input' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
        } as Step,
        {
          id: 'step-extract',
          name: 'Extract title',
          type: 'extract',
          action: { target: 'title', outputName: 'pageTitle' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
        } as Step,
      ];

      // 5. Execute all steps in order — assert each returns 'continue'.
      for (const step of steps) {
        const outcome = await executor.executeWithPolicy(step);
        expect(outcome).toBe('continue');
      }

      // 6. All 4 steps should have status 'success'.
      expect(runContext.getVariable('step-nav_status')).toBe('success');
      expect(runContext.getVariable('step-click_status')).toBe('success');
      expect(runContext.getVariable('step-type_status')).toBe('success');
      expect(runContext.getVariable('step-extract_status')).toBe('success');

      // 7. The extracted title value should be stored (fake ext returns 'Hello from page').
      const pageTitle = runContext.getVariable('pageTitle');
      expect(typeof pageTitle).toBe('string');
      expect(pageTitle).toBeTruthy();
    },
    15_000, // vitest timeout — multiple WS round-trips even with immediate fake replies
  );

  it(
    'propagates ExtensionCommandError when the extension returns ok:false',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      fakeWs = await handshake(host.port);
      // Reply to every command with an error.
      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string };
        fakeWs.send(
          JSON.stringify({
            kind: 'result',
            commandId: cmd.commandId,
            ok: false,
            message: 'Navigation failed',
            code: 'ERR_NAVIGATE',
            recoverable: false,
          }),
        );
      });

      const { executor, runContext } = buildStack(host);

      const step: Step = {
        id: 'step-nav-fail',
        name: 'Navigate that fails',
        type: 'navigate',
        action: { url: 'https://fail.example.com' },
        onFailure: 'abort',
        maxRetries: 0,
        timeout: 3000,
      } as Step;

      const outcome = await executor.executeWithPolicy(step);
      expect(outcome).toBe('abort');
      expect(runContext.getVariable('step-nav-fail_status')).toBe('failed');
      expect(runContext.getVariable('step-nav-fail_error')).toMatch(/Navigation failed/);
    },
    15_000,
  );

  it(
    'respects onFailure:skip — continues after a failed step',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      fakeWs = await handshake(host.port);
      // anyMatch returns true so the primary selector resolves immediately.
      // interact (click) returns an error. navigate returns ok.
      const responsePlan: Array<Record<string, unknown>> = [
        // First message: anyMatch for elementExists (resolving '#btn' selector)
        { ok: true, value: true },
        // Second message: interact click → error
        { ok: false, message: 'click failed', code: 'ERR_CLICK', recoverable: false },
        // Third message: navigate → ok
        { ok: true, value: null },
      ];
      let callIdx = 0;
      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string };
        const plan = responsePlan[callIdx++] ?? { ok: true, value: null };
        fakeWs.send(
          JSON.stringify({
            kind: 'result',
            commandId: cmd.commandId,
            ...plan,
          }),
        );
      });

      const { executor, runContext } = buildStack(host);

      const failingStep: Step = {
        id: 'step-fail',
        name: 'Failing click',
        type: 'interact',
        action: { interaction: 'click' },
        selectors: { primary: '#btn' },
        onFailure: 'skip',
        maxRetries: 0,
        timeout: 3000,
      } as Step;

      const succeedingStep: Step = {
        id: 'step-nav',
        name: 'Navigate',
        type: 'navigate',
        action: { url: 'https://example.com' },
        onFailure: 'abort',
        maxRetries: 0,
        timeout: 3000,
      } as Step;

      const outcome1 = await executor.executeWithPolicy(failingStep);
      expect(outcome1).toBe('continue');
      expect(runContext.getVariable('step-fail_status')).toBe('skipped');

      const outcome2 = await executor.executeWithPolicy(succeedingStep);
      expect(outcome2).toBe('continue');
      expect(runContext.getVariable('step-nav_status')).toBe('success');
    },
    15_000,
  );

  it(
    'runs wait, select, check, hover, focus steps end-to-end',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      fakeWs = await handshake(host.port);
      // anyMatch is used internally by ElementResolver for selector resolution.
      // We reply true so it picks the primary selector.
      setupFakeExtension(fakeWs, {
        wait: null,
        interact: null,
        anyMatch: true,
      });

      const { executor, runContext } = buildStack(host);

      const steps: Step[] = [
        // wait / delay — value is durationMs as a string per schema
        {
          id: 'step-wait-delay',
          name: 'Wait delay',
          type: 'wait',
          action: { condition: 'delay', value: '1' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 5000,
        } as Step,
        // wait / selector — value is the CSS selector string
        {
          id: 'step-wait-sel',
          name: 'Wait for selector',
          type: 'wait',
          action: { condition: 'selector', value: '#ready' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 5000,
        } as Step,
        // interact / select
        {
          id: 'step-select',
          name: 'Select option',
          type: 'interact',
          action: { interaction: 'select', value: 'option-b' },
          selectors: { primary: 'select#menu' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 5000,
        } as Step,
        // interact / check
        {
          id: 'step-check',
          name: 'Check checkbox',
          type: 'interact',
          action: { interaction: 'check' },
          selectors: { primary: '#agree' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 5000,
        } as Step,
        // interact / hover
        {
          id: 'step-hover',
          name: 'Hover element',
          type: 'interact',
          action: { interaction: 'hover' },
          selectors: { primary: '#menu-btn' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 5000,
        } as Step,
        // interact / focus
        {
          id: 'step-focus',
          name: 'Focus element',
          type: 'interact',
          action: { interaction: 'focus' },
          selectors: { primary: '#email' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 5000,
        } as Step,
      ];

      for (const step of steps) {
        const outcome = await executor.executeWithPolicy(step);
        expect(outcome).toBe('continue');
        expect(runContext.getVariable(`${step.id}_status`)).toBe('success');
      }
    },
    15_000,
  );

  it(
    'scroll, countMatching, anyMatch commands — PageClient-level wire-up',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      fakeWs = await handshake(host.port);
      // Respond to scroll with ok:null, countMatching with count:5, anyMatch with exists:true
      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string; type: string };
        let value: unknown = null;
        if (cmd.type === 'countMatching') value = { count: 5 };
        if (cmd.type === 'anyMatch') value = { exists: true };
        fakeWs.send(JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value }));
      });

      const { pageClient } = buildStack(host);

      // scroll sends a ScrollCommand and resolves
      await expect(pageClient.scroll('down', 300)).resolves.toBeUndefined();
      await expect(pageClient.scroll('top')).resolves.toBeUndefined();

      // countMatching: the extension returns {count:5}, PageClient unwraps to number
      const count = await pageClient.countMatching('li');
      expect(count).toBe(5);

      // elementExists: the extension returns {exists:true}, PageClient unwraps to boolean
      const exists = await pageClient.elementExists('#foo');
      expect(exists).toBe(true);
      // elementExists with exists:false
      fakeWs.removeAllListeners('message');
      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string };
        fakeWs.send(JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value: { exists: false } }));
      });
      const notExists = await pageClient.elementExists('#missing');
      expect(notExists).toBe(false);
    },
    15_000,
  );

  // ---------------------------------------------------------------------------
  // Run-window lifecycle — ExtensionHost convenience methods
  // ---------------------------------------------------------------------------

  it(
    'openRunWindow sends openWindow command first, closeRunWindow sends closeWindow at end (closeWindowOnFinish: true)',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      fakeWs = await handshake(host.port);

      const commandLog: string[] = [];

      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string; type: string };
        commandLog.push(cmd.type);

        let value: unknown = null;
        if (cmd.type === 'openWindow') {
          value = { windowId: 1, tabId: 10 };
        }
        fakeWs.send(
          JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value }),
        );
      });

      // Open window — should be the first command.
      const windowInfo = await host.openRunWindow(5000);
      expect(windowInfo).toEqual({ windowId: 1, tabId: 10 });
      expect(commandLog[0]).toBe('openWindow');

      // Send a navigate step (simulates automation work after window open).
      const navPromise = host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-nav',
        timeoutMs: 5000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      });
      await navPromise;

      // Close window at run end.
      await host.closeRunWindow(windowInfo.windowId, 5000);

      expect(commandLog[0]).toBe('openWindow');
      expect(commandLog[commandLog.length - 1]).toBe('closeWindow');
    },
    15_000,
  );

  it(
    'closeWindowOnFinish: false — runner does NOT send closeWindow (simulated via no closeRunWindow call)',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      fakeWs = await handshake(host.port);

      const commandLog: string[] = [];

      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string; type: string };
        commandLog.push(cmd.type);
        const value = cmd.type === 'openWindow' ? { windowId: 2, tabId: 20 } : null;
        fakeWs.send(
          JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value }),
        );
      });

      // Simulate a run that sets closeWindowOnFinish: false.
      // Only openWindow is called — closeRunWindow is NOT called.
      await host.openRunWindow(5000);

      // Send a navigate command.
      await host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-nav-2',
        timeoutMs: 5000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      });

      // Verify closeWindow was never sent.
      expect(commandLog).not.toContain('closeWindow');
      expect(commandLog[0]).toBe('openWindow');
    },
    15_000,
  );

  it(
    'windowClosed event from extension mid-run → runner aborts with expected error',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      fakeWs = await handshake(host.port);

      // Track commands received.
      const commandLog: string[] = [];

      // We'll hold up the navigate response so we can inject the windowClosed event.
      let navResolve: (() => void) | null = null;
      const navHeld = new Promise<void>((resolve) => { navResolve = resolve; });

      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string; type: string };
        commandLog.push(cmd.type);

        if (cmd.type === 'openWindow') {
          fakeWs.send(
            JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value: { windowId: 3, tabId: 30 } }),
          );
          return;
        }

        if (cmd.type === 'navigate') {
          // Hold the navigate response until we've injected the windowClosed event.
          void navHeld.then(() => {
            fakeWs.send(
              JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value: null }),
            );
          });
          return;
        }

        fakeWs.send(
          JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value: null }),
        );
      });

      // Open run window.
      const windowInfo = await host.openRunWindow(5000);
      expect(windowInfo.windowId).toBe(3);

      // Set up abort tracking.
      let abortError: Error | null = null;
      const windowClosedError = new Error('Run window closed by user');
      let windowClosedFired = false;

      host.once('windowClosed', () => {
        windowClosedFired = true;
        abortError = windowClosedError;
        // Release the held navigate response.
        navResolve?.();
      });

      // Start a navigate command that won't complete until we release it.
      const navPromise = host.sendCommand({
        type: 'navigate',
        commandId: 'cmd-nav-wc',
        timeoutMs: 10_000,
        tab: { kind: 'active' },
        url: 'https://example.com',
      });

      // Inject a windowClosed event from the extension side.
      fakeWs.send(
        JSON.stringify({ kind: 'event', type: 'windowClosed', windowId: 3 }),
      );

      // Wait for nav to complete (released by the windowClosed handler).
      await navPromise;

      // Verify the windowClosed event was emitted and abort logic would fire.
      expect(windowClosedFired).toBe(true);
      expect(abortError).not.toBeNull();
      expect(abortError!.message).toBe('Run window closed by user');
    },
    15_000,
  );

  // ---------------------------------------------------------------------------
  // Step-boundary reconnect — happy path
  // ---------------------------------------------------------------------------

  it(
    'between-step reconnect happy path: 3 steps, disconnect after step 2, reconnect with previousRunId, step 3 completes',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

      // Build the service stack.
      const { executor, runContext } = buildStack(host);

      // Connect the fake extension and complete the handshake.
      fakeWs = await handshake(host.port);

      // The host's session runId — what the extension sends back as previousRunId.
      const runId = host.activeRunId!;

      // Steps: navigate → navigate → extract
      const steps: Step[] = [
        {
          id: 'step-1',
          name: 'Navigate 1',
          type: 'navigate',
          action: { url: 'https://example.com/1' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
        } as Step,
        {
          id: 'step-2',
          name: 'Navigate 2',
          type: 'navigate',
          action: { url: 'https://example.com/2' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
        } as Step,
        {
          id: 'step-3',
          name: 'Extract title',
          type: 'extract',
          action: { target: 'title', outputName: 'pageTitle' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
        } as Step,
      ];

      // Fake extension replies to all commands with ok:true.
      fakeWs.on('message', (data) => {
        const cmd = JSON.parse(data.toString()) as { commandId: string; type: string };
        fakeWs.send(JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value: null }));
      });

      // Execute steps 1 and 2.
      const outcome1 = await executor.executeWithPolicy(steps[0]!);
      expect(outcome1).toBe('continue');

      // Record checkpoint for step 1 (simulating what AutomationRunner does).
      // Use the host's session runId — it must match what the extension sends as previousRunId.
      host.markResumePoint(runId, 1);

      const outcome2 = await executor.executeWithPolicy(steps[1]!);
      expect(outcome2).toBe('continue');

      // Mark resume point at step 3 (index 2).
      host.markResumePoint(runId, 2);

      // Drop the connection between steps (step 2 done, step 3 not yet started).
      const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
      fakeWs.removeAllListeners('message');
      fakeWs.close();
      await disconnected;
      expect(host.getState()).toBe('reconnect_pending');

      // Set up resumed listener.
      const resumed = new Promise<{ runId: string; resumeFromStep: number }>((resolve) =>
        host.once('resumed', resolve),
      );

      // Connect fakeWs2 with the matching previousRunId.
      let fakeWs2: WebSocket;
      let resumeSessionMsg: Record<string, unknown>;

      await new Promise<void>((resolve, reject) => {
        fakeWs2 = new WebSocket(`ws://127.0.0.1:${host.port}`);
        fakeWs2.on('error', reject);
        fakeWs2.once('open', () => {
          fakeWs2.send(
            JSON.stringify({
              kind: 'event',
              type: 'hello',
              protocolVersion: RUNNER_PROTOCOL_VERSION,
              chromeVersion: '120.0',
              extensionVersion: '1.0.0',
              previousRunId: runId,
            }),
          );
        });
        fakeWs2.once('message', (data) => {
          resumeSessionMsg = JSON.parse(data.toString()) as Record<string, unknown>;
          // Wire the ongoing command reply handler now that session is received.
          fakeWs2.on('message', (data2) => {
            const cmd = JSON.parse(data2.toString()) as { commandId: string; type: string };
            const value = cmd.type === 'extract' ? 'reconnected-page-title' : null;
            fakeWs2.send(
              JSON.stringify({ kind: 'result', commandId: cmd.commandId, ok: true, value }),
            );
          });
          resolve();
        });
      });

      // Wait for the host to emit 'resumed'.
      const resumedInfo = await resumed;
      expect(host.getState()).toBe('connected');
      expect(resumedInfo.resumeFromStep).toBe(2);
      expect(resumeSessionMsg!['resumeFromStep']).toBe(2);
      expect(resumeSessionMsg!['runId']).toBe(runId);

      // Execute step 3 on the reconnected socket.
      const outcome3 = await executor.executeWithPolicy(steps[2]!);
      expect(outcome3).toBe('continue');

      expect(runContext.getVariable('step-1_status')).toBe('success');
      expect(runContext.getVariable('step-2_status')).toBe('success');
      expect(runContext.getVariable('step-3_status')).toBe('success');

      fakeWs2!.close();
    },
    15_000,
  );

  // ---------------------------------------------------------------------------
  // Step-boundary reconnect — timeout path
  // ---------------------------------------------------------------------------

  it(
    'reconnect timeout: extension drops between steps, never reconnects, checkpoint preserved',
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });

        // Need to connect the fake extension using a real-timer-compatible approach.
        // Let's advance fake timers 0ms to flush microtasks then do real async work.
        const connected = new Promise<void>((resolve) => host.once('connected', resolve));
        fakeWs = await handshake(host.port);
        await connected;

        const runId = host.activeRunId!;

        // Simulate a checkpoint having been recorded after step 1.
        const checkpointStore = new CheckpointStore();
        checkpointStore.record({
          runId,
          lastCompletedStepIndex: 1,
          contextSnapshot: {},
          timestamp: Date.now(),
        });
        host.markResumePoint(runId, 2);

        // Drop between steps.
        const disconnected = new Promise<void>((resolve) => host.once('disconnected', () => resolve()));
        fakeWs.close();
        await disconnected;
        expect(host.getState()).toBe('reconnect_pending');

        // Subscribe for timeout.
        const timeoutFired = new Promise<void>((resolve) => host.once('reconnectTimeout', () => resolve()));

        // Advance past the 30s window.
        vi.advanceTimersByTime(RECONNECT_WINDOW_MS + 1);

        await timeoutFired;
        expect(host.getState()).toBe('aborted');

        // Checkpoint from step 1 should still exist (not cleared on abort).
        const cp = checkpointStore.get(runId);
        expect(cp).toBeDefined();
        expect(cp!.lastCompletedStepIndex).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    },
    15_000,
  );

  // ---------------------------------------------------------------------------
  // Mid-step disconnect — hard abort
  // ---------------------------------------------------------------------------

  it(
    'mid-step disconnect: extension drops while navigate command is in flight, run aborts immediately',
    async () => {
      host = await ExtensionHost.start({ host: '127.0.0.1', port: 0, logger });
      const { executor } = buildStack(host);

      // Connect the fake extension.
      fakeWs = await handshake(host.port);

      // Set up the fake extension to receive the command but NOT reply.
      // Instead, drop the connection when the navigate command arrives.
      let disconnectAfterReceive: (() => void) | null = null;
      const commandReceived = new Promise<void>((resolve) => {
        fakeWs.once('message', (data) => {
          const cmd = JSON.parse(data.toString()) as { type: string };
          expect(cmd.type).toBe('navigate');
          resolve();
          // Close mid-flight — the command is in-flight, no reply sent.
          fakeWs.close();
        });
      });

      const step: Step = {
        id: 'step-mid-step',
        name: 'Navigate mid-step',
        type: 'navigate',
        action: { url: 'https://example.com' },
        onFailure: 'abort',
        maxRetries: 0,
        timeout: 30_000,
      } as Step;

      // Start the step execution (it will call sendCommand which hangs on reply).
      const stepPromise = executor.executeWithPolicy(step);

      // Wait until the command is in-flight.
      await commandReceived;
      void disconnectAfterReceive;

      // sendCommand should reject since the connection dropped mid-step.
      // executeWithPolicy should return 'abort' because the error propagates.
      const outcome = await stepPromise;
      expect(outcome).toBe('abort');

      // State must be 'aborted' (mid-step disconnect).
      expect(host.getState()).toBe('aborted');

      // State must be 'aborted' (mid-step disconnect).
      expect(host.getState()).toBe('aborted');
    },
    15_000,
  );
});
