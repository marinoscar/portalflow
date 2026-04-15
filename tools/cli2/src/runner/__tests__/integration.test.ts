/**
 * Integration test — full pipeline without a real browser.
 *
 * Spins up a real ExtensionHost on an ephemeral port, opens a fake WebSocket
 * client that replies to navigate/click/type/extract commands with canned
 * ok:true responses, and runs a 4-step automation through the StepExecutor.
 *
 * This proves the full cli2 pipeline (StepExecutor → PageClient →
 * ExtensionHost → WS) end-to-end with no Chrome dependency.
 *
 * Each test sets a vitest timeout of 15 s to accommodate multiple WS
 * round-trips (fake extension replies immediately but the event loop still
 * adds latency per call).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import pino from 'pino';
import { ExtensionHost } from '../../browser/extension-host.js';
import { PageClient } from '../../browser/page-client.js';
import { PageContextCapture } from '../../browser/context.js';
import { ElementResolver } from '../../browser/element-resolver.js';
import { RunContext } from '../run-context.js';
import { RunPresenter } from '../run-presenter.js';
import { StepExecutor } from '../step-executor.js';
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

describe('cli2 pipeline integration', () => {
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

      // 3. Build the cli2 service stack.
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
});
