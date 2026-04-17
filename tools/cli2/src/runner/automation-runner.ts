import { readFile } from 'node:fs/promises';
import { AutomationSchema } from '@portalflow/schema';
import type { Automation, FunctionDefinition } from '@portalflow/schema';
import { ExtensionHost } from '../browser/extension-host.js';
import { PageClient } from '../browser/page-client.js';
import { PageContextCapture } from '../browser/context.js';
import { ElementResolver } from '../browser/element-resolver.js';
import { LlmService } from '../llm/llm.service.js';
import { ToolExecutor } from '../tools/tool-executor.js';
import { SmscliAdapter } from '../tools/smscli.adapter.js';
import { VaultcliAdapter } from '../tools/vaultcli.adapter.js';
import type { Tool } from '../tools/tool.interface.js';
import { RunContext, type RunResult } from './run-context.js';
// StepExecutor is imported below — see commit 2 of task 7 where it is created.
import { StepExecutor } from './step-executor.js';
import { createRunLogger, defaultLogFilePath, resolveLoggingConfig } from './logger.js';
import { RunPresenter } from './run-presenter.js';
import { ConfigService } from '../config/config.service.js';
import { defaultExtensionConfig } from '../config/config.service.js';
import { resolvePaths, resolveVideo } from './paths.js';
import { launchChromeAndWaitForExtension } from '../browser/chrome-launcher.js';
import { CheckpointStore, snapshotRunContext, restoreRunContext } from './checkpoint.js';

export interface RunOptions {
  video?: boolean;
  videoDir?: string;
  screenshotDir?: string;
  downloadDir?: string;
  automationsDir?: string;
  /** CLI-supplied input overrides. Any key present here wins over the input's source. */
  inputs?: Map<string, string>;
  /** CLI-supplied log level override (--log-level flag). */
  logLevel?: string;
  /**
   * When `true`, disable the RunPresenter and let pino print to stdout
   * as it did pre-1.1.16. Useful for debugging the runner itself.
   * Defaults to `false` — new runs get the clean presenter view and
   * all log lines are written to a file instead.
   */
  verbose?: boolean;
  /**
   * An already-started ExtensionHost to reuse. When provided, the runner
   * will NOT start or close the host — the caller is responsible for its
   * lifecycle. When omitted, the runner starts its own host and closes it
   * after the run.
   *
   * Task 9 will replace the manual host-start path with a chrome-launcher
   * that boots Chrome with the extension pre-loaded, so callers will never
   * need to manage the host lifecycle manually.
   */
  extensionHost?: ExtensionHost;
  /**
   * Timeout in milliseconds to wait for the extension to connect before
   * aborting the run. Only relevant when the runner starts its own
   * ExtensionHost (i.e., `extensionHost` is not supplied). Default: 30_000.
   */
  extensionConnectTimeoutMs?: number;
}

/**
 * Wait for the ExtensionHost to emit its first 'connected' event, with a
 * timeout. Resolves immediately if a connection is already active.
 */
function waitForExtensionConnection(
  host: ExtensionHost,
  timeoutMs: number,
): Promise<void> {
  if (host.isConnected()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Extension did not connect within ${timeoutMs}ms — see README for Chrome extension setup. ` +
          `Ensure the PortalFlow extension is installed and Chrome is running before starting portalflow2.`,
        ),
      );
    }, timeoutMs);

    host.once('connected', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class AutomationRunner {
  async run(automationPath: string, options?: RunOptions): Promise<RunResult> {
    // ------------------------------------------------------------------
    // 1. Read and parse the automation file
    // ------------------------------------------------------------------
    let raw: string;
    try {
      raw = await readFile(automationPath, 'utf-8');
    } catch (err) {
      throw new Error(`Cannot read automation file "${automationPath}": ${String(err)}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Automation file "${automationPath}" is not valid JSON: ${String(err)}`);
    }

    // ------------------------------------------------------------------
    // 2. Validate with AutomationSchema
    // ------------------------------------------------------------------
    const parsed = AutomationSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Automation file "${automationPath}" failed schema validation:\n` +
          JSON.stringify(parsed.error.flatten(), null, 2),
      );
    }

    const automation: Automation = parsed.data;

    // ------------------------------------------------------------------
    // 3. Load user config early so the logger picks up logging settings
    // ------------------------------------------------------------------
    const configService = new ConfigService();
    const userConfig = await configService.load();
    const loggingConfig = resolveLoggingConfig(userConfig.logging, options?.logLevel);

    // Presenter mode (default): stdout is owned by the RunPresenter so
    // the user sees a clean stream of steps and LLM decisions. Pino is
    // redirected to a file so the detailed log is still available for
    // troubleshooting. If the user didn't configure a log file, we
    // generate a default path under ~/.portalflow/logs/.
    //
    // `--verbose` flips the switch: pino writes to stdout as before and
    // the presenter becomes a silent no-op.
    const presenterEnabled = !(options?.verbose ?? false);
    if (presenterEnabled) {
      if (!loggingConfig.file) {
        loggingConfig.file = defaultLogFilePath(automation.name);
      }
      loggingConfig.fileOnly = true;
    }

    const logger = createRunLogger(automation.name, loggingConfig);
    const presenter = new RunPresenter(
      presenterEnabled,
      loggingConfig.file ?? '(no log file)',
    );

    logger.info(
      {
        id: automation.id,
        name: automation.name,
        version: automation.version,
        logging: {
          level: loggingConfig.level,
          file: loggingConfig.file ?? null,
          pretty: loggingConfig.pretty,
          redactSecrets: loggingConfig.redactSecrets,
          fileOnly: loggingConfig.fileOnly ?? false,
        },
      },
      'Starting automation run',
    );

    // ------------------------------------------------------------------
    // 4. Create RunContext
    // ------------------------------------------------------------------
    const context = new RunContext(automation.name, logger);

    // ------------------------------------------------------------------
    // 5. Resolve inputs → context variables
    // ------------------------------------------------------------------
    const toolExecutor = new ToolExecutor();
    const vaultAdapter = new VaultcliAdapter(toolExecutor);

    for (const input of automation.inputs) {
      let resolved: string | undefined;

      // CLI override wins over every source — check it first.
      const cliOverride = options?.inputs?.get(input.name);

      switch (input.source ?? 'literal') {
        case 'env':
          resolved = cliOverride ?? (input.value ? process.env[input.value] : process.env[input.name]);
          break;

        case 'vaultcli': {
          if (cliOverride !== undefined) {
            logger.info({ input: input.name }, 'vaultcli source: using CLI override instead of vault lookup');
            resolved = cliOverride;
            break;
          }
          if (!input.value) {
            logger.warn(
              { input: input.name },
              'vaultcli source requires a value (secret name); skipping',
            );
            break;
          }
          try {
            const vaultResult = await vaultAdapter.execute('secrets-get', { name: input.value });
            if (!vaultResult.success) {
              logger.warn(
                { input: input.name, error: vaultResult.error },
                'Failed to retrieve secret from vaultcli',
              );
              break;
            }
            // Explode every field into <inputName>_<key> context variables.
            if (vaultResult.fields) {
              for (const [k, v] of Object.entries(vaultResult.fields)) {
                context.setVariable(`${input.name}_${k}`, v);
              }
              // If the secret has a field matching the input name, use that
              // single value. E.g. input.name === 'password' and the vault
              // returns {username, password} → resolved = fields.password.
              if (input.name in vaultResult.fields) {
                resolved = vaultResult.fields[input.name];
              } else {
                resolved = vaultResult.output;
              }
              logger.info(
                { input: input.name, fields: Object.keys(vaultResult.fields), matched: input.name in vaultResult.fields },
                'Resolved vaultcli secret with multi-field exploding',
              );
            } else {
              resolved = vaultResult.output;
            }
          } catch (err) {
            logger.warn({ input: input.name, err }, 'vaultcli call threw an error');
          }
          break;
        }

        case 'literal':
          resolved = cliOverride ?? input.value;
          break;

        case 'cli_arg': {
          // 1. CLI flag override wins first
          if (cliOverride !== undefined) {
            resolved = cliOverride;
            break;
          }
          // 2. Fall back to the input's declared default (value field)
          if (input.value !== undefined && input.value !== '') {
            resolved = input.value;
            logger.debug({ input: input.name }, 'cli_arg source: using default from input.value');
            break;
          }
          // 3. Nothing — leaves resolved as undefined, will error below if required
          break;
        }
      }

      if (resolved !== undefined) {
        context.setVariable(input.name, resolved);
        logger.debug({ input: input.name }, 'Input resolved and stored as context variable');
      } else if (input.required) {
        throw new Error(
          `Required input "${input.name}" could not be resolved (source: ${input.source ?? 'literal'}).\n` +
            `Provide a value via --input ${input.name}=<value> or run interactively with 'portalflow2 run' (no file argument) to be prompted.`,
        );
      } else {
        logger.debug({ input: input.name }, 'Optional input not resolved; skipping');
      }
    }

    // ------------------------------------------------------------------
    // 6. Initialize LlmService
    // ------------------------------------------------------------------
    const llmService = new LlmService(logger);
    try {
      await llmService.initialize();
    } catch (err) {
      logger.warn(
        { err },
        'LLM service initialization failed — AI element resolution will not be available',
      );
    }

    // ------------------------------------------------------------------
    // 7. Resolve effective paths and video config
    // ------------------------------------------------------------------
    const settings = automation.settings;

    const effectivePaths = resolvePaths(userConfig, settings, {
      automations: options?.automationsDir,
      screenshots: options?.screenshotDir,
      videos: options?.videoDir,
      downloads: options?.downloadDir,
    });
    const effectiveVideo = resolveVideo(userConfig, settings, {
      enabled: options?.video,
    });

    logger.info(
      {
        screenshots: effectivePaths.screenshots,
        videos: effectivePaths.videos,
        downloads: effectivePaths.downloads,
        videoEnabled: effectiveVideo.enabled,
      },
      'Resolved artifact paths',
    );

    // ------------------------------------------------------------------
    // 8. Set up ExtensionHost and PageClient
    //
    // If the caller supplies an already-started ExtensionHost (e.g. in
    // tests or a future chrome-launcher integration), use it directly.
    // Otherwise, start a new host using the config's extension settings
    // and block until the Chrome extension connects.
    //
    // Task 9 will replace this block with a chrome-launcher.ts that
    // boots Chrome with the extension pre-loaded, eliminating the need
    // for the user to manage Chrome manually.
    // ------------------------------------------------------------------
    const extensionCfg = userConfig.extension ?? defaultExtensionConfig();
    const connectTimeoutMs = options?.extensionConnectTimeoutMs ?? 30_000;

    let ownedHost = false;
    let extensionHost: ExtensionHost;
    let runWindowInfo: { windowId: number; tabId: number } | null = null;

    if (options?.extensionHost) {
      extensionHost = options.extensionHost;
      logger.info({ port: extensionHost.port }, 'Using caller-supplied ExtensionHost');
    } else {
      logger.info(
        { host: extensionCfg.host, port: extensionCfg.port },
        'Starting ExtensionHost — launching Chrome and waiting for extension to connect...',
      );
      extensionHost = await ExtensionHost.start({
        host: extensionCfg.host,
        port: extensionCfg.port,
        logger,
      });
      ownedHost = true;
      logger.info(
        { port: extensionHost.port },
        `ExtensionHost listening — launching Chrome with profileMode=${extensionCfg.profileMode}`,
      );

      // Only launch Chrome automatically when profileMode is 'dedicated' or 'real'.
      // If profileMode is 'unset', fall back to the legacy wait-for-manual-connect path
      // so existing users aren't broken. The first-run prompt (ensureProfileChoice) sets
      // this to a real value before production runs.
      if (extensionCfg.profileMode === 'dedicated' || extensionCfg.profileMode === 'real') {
        try {
          await launchChromeAndWaitForExtension(extensionHost, extensionCfg, logger);
          logger.info({ port: extensionHost.port }, 'Chrome launched and extension connected');
        } catch (err) {
          await extensionHost.close().catch((closeErr) => {
            logger.warn({ err: closeErr }, 'Error closing ExtensionHost after launch failure (non-fatal)');
          });
          throw new Error(
            `Chrome / extension handshake failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        // profileMode === 'unset' — legacy behaviour: wait for manual Chrome+extension connection.
        logger.info(
          { port: extensionHost.port },
          `ExtensionHost listening — waiting up to ${connectTimeoutMs}ms for extension (manual connection mode)`,
        );
        await waitForExtensionConnection(extensionHost, connectTimeoutMs);
        logger.info({ port: extensionHost.port }, 'Chrome extension connected (manual mode)');
      }

      // Open the dedicated automation window now that Chrome is connected.
      try {
        runWindowInfo = await extensionHost.openRunWindow();
        logger.info(runWindowInfo, 'Automation run window opened');
      } catch (err) {
        await extensionHost.close().catch((closeErr) => {
          logger.warn({ err: closeErr }, 'Error closing ExtensionHost after openWindow failure (non-fatal)');
        });
        throw new Error(
          `Failed to open automation run window: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const pageClient = new PageClient({
      host: extensionHost,
      logger,
      getScreenshotDir: () => effectivePaths.screenshots,
      getDownloadDir: () => effectivePaths.downloads,
    });

    // ------------------------------------------------------------------
    // 9. Create services and tools
    // ------------------------------------------------------------------
    const contextCapture = new PageContextCapture(pageClient);
    const elementResolver = new ElementResolver(pageClient, llmService, contextCapture);

    const smscliAdapter = new SmscliAdapter(toolExecutor);

    const tools = new Map<string, Tool>([
      ['smscli', smscliAdapter],
      ['vaultcli', vaultAdapter],
    ]);

    // ------------------------------------------------------------------
    // 10. Create StepExecutor
    // ------------------------------------------------------------------
    const screenshotOnFailure = settings?.screenshotOnFailure ?? true;

    const functionsMap = new Map<string, FunctionDefinition>();
    for (const fn of automation.functions ?? []) {
      functionsMap.set(fn.name, fn);
    }

    const stepExecutor = new StepExecutor(
      pageClient,
      elementResolver,
      tools,
      context,
      screenshotOnFailure,
      contextCapture,
      llmService,
      functionsMap,
      presenter,
    );

    // ------------------------------------------------------------------
    // 11. Execute steps
    // ------------------------------------------------------------------
    //
    // The top-level step loop runs as an instruction pointer (`i`) over
    // the `steps` array. Normal steps advance i by 1; a jump outcome
    // (from a condition.thenStep/elseStep or a goto step) resets i to
    // the index of the named target step.
    //
    // A hard execution cap (MAX_STEP_EXECUTIONS) bounds the total work
    // done by a single run, so a broken goto loop fails fast with a
    // clear error instead of hanging the process.
    const steps = automation.steps;
    const stepIndexById = new Map<string, number>();
    for (let j = 0; j < steps.length; j++) {
      stepIndexById.set(steps[j]!.id, j);
    }

    presenter.runStart(automation.name, steps.length);

    // ------------------------------------------------------------------
    // Checkpoint store — step-boundary reconnect recovery
    // ------------------------------------------------------------------
    const checkpointStore = new CheckpointStore();
    // Use the ExtensionHost's session runId as the checkpoint key — it's
    // what the extension sends back as `previousRunId` on reconnect, so the
    // host can match it. The RunContext has its own runId for template
    // functions; the host/session runId is used for reconnect matching.
    const runId = extensionHost.activeRunId ?? context.runId;

    // ------------------------------------------------------------------
    // Run-window abort signal
    //
    // If the user closes the dedicated run window or its tab during the run,
    // we abort the step loop with a clear error rather than continuing to send
    // commands to a non-existent window.
    // ------------------------------------------------------------------
    let runWindowClosedError: Error | null = null;
    // Reconnect/abort signals from the extension host state machine.
    let runAbortError: Error | null = null;
    let reconnectPending = false;

    function onWindowClosed(event: { windowId?: number }): void {
      logger.warn({ windowId: event.windowId }, 'Run window closed by user — aborting run');
      runWindowClosedError = new Error('Run window closed by user');
    }

    function onTabClosed(event: { tabId?: number }): void {
      logger.warn({ tabId: event.tabId }, 'Run tab closed by user — aborting run');
      runWindowClosedError = new Error('Run window closed by user');
    }

    function onDisconnected(reason: string): void {
      if (reason === 'reconnect_pending') {
        const cp = checkpointStore.get(runId);
        const stepIdx = cp ? cp.lastCompletedStepIndex + 1 : 0;
        logger.warn(
          { runId, reason, resumeAtStep: stepIdx },
          'Extension disconnected — waiting up to 30s for reconnect',
        );
        reconnectPending = true;
      } else {
        logger.warn({ runId, reason }, 'Extension disconnected (mid-step or replaced) — aborting run');
        runAbortError = new Error('Extension disconnected mid-step — run aborted');
      }
    }

    function onResumed(info: { runId: string; resumeFromStep: number }): void {
      logger.info(
        { runId: info.runId, resumeFromStep: info.resumeFromStep },
        'Extension reconnected — resuming run',
      );
      reconnectPending = false;
      // Restore context from the last checkpoint so any in-memory state is consistent.
      const cp = checkpointStore.get(info.runId);
      if (cp) {
        restoreRunContext(context, cp.contextSnapshot);
      }
    }

    function onReconnectTimeout(info: { runId: string }): void {
      const cp = checkpointStore.get(info.runId);
      const stepIdx = cp ? cp.lastCompletedStepIndex + 1 : 0;
      logger.error(
        { runId: info.runId, stepIdx },
        'Extension did not reconnect within 30s — aborting run',
      );
      reconnectPending = false;
      runAbortError = new Error(
        `Extension did not reconnect within 30s — run aborted at step ${stepIdx}`,
      );
    }

    extensionHost.on('disconnected', onDisconnected);
    extensionHost.on('resumed', onResumed);
    extensionHost.on('reconnectTimeout', onReconnectTimeout);

    if (runWindowInfo !== null) {
      extensionHost.on('windowClosed', onWindowClosed);
      extensionHost.on('tabClosed', onTabClosed);
    }

    const MAX_STEP_EXECUTIONS = 1000;
    let executionsRemaining = MAX_STEP_EXECUTIONS;
    let i = 0;

    try {
      while (i < steps.length) {
        // Check if the run window was closed by the user.
        if (runWindowClosedError !== null) {
          throw runWindowClosedError;
        }
        // Check for a hard abort (mid-step disconnect or reconnect timeout).
        if (runAbortError !== null) {
          throw runAbortError;
        }
        // Check if we're waiting for a reconnect — spin-wait with small yields.
        if (reconnectPending) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          continue;
        }

        if (executionsRemaining-- <= 0) {
          throw new Error(
            `Step execution cap (${MAX_STEP_EXECUTIONS}) exceeded — likely a goto loop. ` +
              `Add a condition that breaks the cycle or raise the cap.`,
          );
        }

        const step = steps[i]!;
        logger.info(
          {
            stepId: step.id,
            stepName: step.name,
            type: step.type,
            index: i + 1,
            total: steps.length,
            executionsRemaining,
          },
          'Executing step',
        );

        presenter.stepStart(step, i, steps.length);
        const stepStartedAt = Date.now();
        const outcome = await stepExecutor.executeWithPolicy(step);
        const stepDurationMs = Date.now() - stepStartedAt;

        // The executor records the step's terminal outcome on the
        // context via recordStepOutcome, which stores <stepId>_status
        // and <stepId>_error as variables. Read them back to decide
        // which icon the presenter shows.
        const stepStatus = context.getVariable(`${step.id}_status`);
        const stepError = context.getVariable(`${step.id}_error`);

        if (outcome === 'abort') {
          presenter.stepEnd(step, stepDurationMs, 'failed', stepError || undefined);
          // abort policy — stop processing further steps
          break;
        }

        presenter.stepEnd(
          step,
          stepDurationMs,
          stepStatus === 'skipped' ? 'skipped' : 'success',
          stepStatus === 'skipped' ? stepError || undefined : undefined,
        );

        context.incrementCompleted();

        if (typeof outcome === 'object' && outcome.kind === 'jump') {
          const target = outcome.targetStepId;
          const nextIndex = stepIndexById.get(target);
          if (nextIndex === undefined) {
            throw new Error(
              `Step "${step.id}" requested a jump to "${target}", but no top-level step with that id exists. ` +
                `Jumps must reference top-level step ids; loop substeps and function body steps are not valid targets.`,
            );
          }
          logger.info(
            { from: step.id, to: target, executionsRemaining },
            'Jumping to step',
          );

          // Checkpoint before the jump so resume lands at the correct position.
          checkpointStore.record({
            runId,
            lastCompletedStepIndex: i,
            contextSnapshot: snapshotRunContext(context),
            timestamp: Date.now(),
          });
          extensionHost.markResumePoint(runId, nextIndex);

          i = nextIndex;
          continue;
        }

        // Checkpoint after each successfully-completed step (non-jump path).
        checkpointStore.record({
          runId,
          lastCompletedStepIndex: i,
          contextSnapshot: snapshotRunContext(context),
          timestamp: Date.now(),
        });
        extensionHost.markResumePoint(runId, i + 1);

        i += 1;
      }

      // Successful completion — clear the checkpoint.
      checkpointStore.clear(runId);
    } finally {
      // ------------------------------------------------------------------
      // 12. Tear down run window listeners and close the host
      // ------------------------------------------------------------------

      // Remove all lifecycle listeners attached for this run.
      extensionHost.off('disconnected', onDisconnected);
      extensionHost.off('resumed', onResumed);
      extensionHost.off('reconnectTimeout', onReconnectTimeout);
      if (runWindowInfo !== null) {
        extensionHost.off('windowClosed', onWindowClosed);
        extensionHost.off('tabClosed', onTabClosed);
      }

      if (ownedHost) {
        // Conditionally close the run window based on config.
        if (runWindowInfo !== null) {
          const closeWindowOnFinish = extensionCfg.closeWindowOnFinish ?? true;
          if (closeWindowOnFinish) {
            await extensionHost.closeRunWindow(runWindowInfo.windowId);
            logger.info({ windowId: runWindowInfo.windowId }, 'Run window closed on finish');
          } else {
            logger.info(
              { windowId: runWindowInfo.windowId },
              'Run window left open for inspection (closeWindowOnFinish: false)',
            );
          }
        }

        try {
          await extensionHost.close();
          logger.info('ExtensionHost closed');
        } catch (err) {
          logger.warn({ err }, 'Error closing ExtensionHost (non-fatal)');
        }
      }
    }

    // ------------------------------------------------------------------
    // 13. Log execution summary and return result
    // ------------------------------------------------------------------
    const result = context.toResult(steps.length);

    logger.info(
      {
        success: result.success,
        stepsCompleted: result.stepsCompleted,
        stepsTotal: result.stepsTotal,
        errorCount: result.errors.length,
        artifactCount: result.artifacts.length,
        durationMs: result.completedAt.getTime() - result.startedAt.getTime(),
      },
      'Automation run complete',
    );

    if (result.errors.length > 0) {
      for (const e of result.errors) {
        logger.error({ stepId: e.stepId, stepName: e.stepName }, e.message);
      }
    }

    presenter.runEnd(result);

    return result;
  }
}
