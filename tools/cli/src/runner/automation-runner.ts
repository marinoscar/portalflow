import { readFile } from 'node:fs/promises';
import { AutomationSchema } from '@portalflow/schema';
import type { Automation, FunctionDefinition } from '@portalflow/schema';
import { BrowserService } from '../browser/browser.service.js';
import { PageService } from '../browser/page.service.js';
import { PageContextCapture } from '../browser/context.js';
import { ElementResolver } from '../browser/element-resolver.js';
import { LlmService } from '../llm/llm.service.js';
import { ToolExecutor } from '../tools/tool-executor.js';
import { SmscliAdapter } from '../tools/smscli.adapter.js';
import { VaultcliAdapter } from '../tools/vaultcli.adapter.js';
import type { Tool } from '../tools/tool.interface.js';
import { RunContext, type RunResult } from './run-context.js';
import { StepExecutor } from './step-executor.js';
import { createRunLogger, defaultLogFilePath, resolveLoggingConfig } from './logger.js';
import { RunPresenter } from './run-presenter.js';
import { ConfigService } from '../config/config.service.js';
import { resolvePaths, resolveVideo } from './paths.js';

export interface RunOptions {
  headless?: boolean;
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
  // ---- Browser profile overrides (--browser-* flags) ----
  /** "isolated" | "persistent" — overrides config.browser.mode for this run. */
  browserMode?: 'isolated' | 'persistent';
  /** Channel override (e.g. "chrome", "msedge"). */
  browserChannel?: string;
  /** User data directory override. */
  browserUserDataDir?: string;
  /** Sub-profile name override (e.g. "Default", "Profile 1"). */
  browserProfileDirectory?: string;
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
            // Primary variable: the JSON envelope so templates can still
            // reference `{{creds}}` for inspection.
            resolved = vaultResult.output;
            // Explode every field into <inputName>_<key> context variables.
            if (vaultResult.fields) {
              for (const [k, v] of Object.entries(vaultResult.fields)) {
                context.setVariable(`${input.name}_${k}`, v);
              }
              logger.info(
                { input: input.name, fields: Object.keys(vaultResult.fields) },
                'Resolved vaultcli secret with multi-field exploding',
              );
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
            `Provide a value via --input ${input.name}=<value> or run interactively with 'portalflow run' (no file argument) to be prompted.`,
        );
      } else {
        logger.debug({ input: input.name }, 'Optional input not resolved; skipping');
      }
    }

    // ------------------------------------------------------------------
    // 6. Initialize LlmService (passes the run logger through so provider
    //    calls are logged with latency + token usage at debug level)
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
    // 8. Launch BrowserService (logger is passed so page lifecycle
    //    events — framenavigated, pageerror, requestfailed, console
    //    warnings — are captured in the run log at debug level)
    // ------------------------------------------------------------------
    const browserService = new BrowserService(logger);

    const headless = options?.headless ?? settings?.headless ?? false;

    // Resolve effective browser config. Precedence (highest to lowest):
    //   1. CLI flags  (--browser-mode / --browser-channel / etc.)
    //   2. config file `browser` section
    //   3. defaults (mode = "isolated", everything else unset)
    const storedBrowser = userConfig.browser ?? {};
    const browserMode =
      options?.browserMode ?? storedBrowser.mode ?? 'isolated';
    const browserChannel =
      (options?.browserChannel as typeof storedBrowser.channel | undefined) ??
      storedBrowser.channel;
    const browserUserDataDir =
      options?.browserUserDataDir ?? storedBrowser.userDataDir;
    const browserProfileDirectory =
      options?.browserProfileDirectory ?? storedBrowser.profileDirectory;

    logger.info(
      {
        mode: browserMode,
        channel: browserChannel ?? 'chromium',
        userDataDir: browserUserDataDir ?? null,
        profileDirectory: browserProfileDirectory ?? null,
      },
      'Resolved browser config',
    );

    await browserService.launch({
      headless,
      viewport: settings?.viewport,
      userAgent: settings?.userAgent,
      screenshotDir: effectivePaths.screenshots,
      videoDir: effectivePaths.videos,
      downloadDir: effectivePaths.downloads,
      recordVideo: effectiveVideo.enabled,
      videoSize: { width: effectiveVideo.width, height: effectiveVideo.height },
      mode: browserMode,
      channel: browserChannel,
      userDataDir: browserUserDataDir,
      profileDirectory: browserProfileDirectory,
    });

    logger.info({ headless }, 'Browser launched');

    // ------------------------------------------------------------------
    // 9. Create services and tools
    // ------------------------------------------------------------------
    const getPage = () => browserService.getPage();
    const pageService = new PageService(getPage, () => browserService.getDownloadDir());
    const contextCapture = new PageContextCapture(getPage);
    const elementResolver = new ElementResolver(getPage, llmService, contextCapture);

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
      pageService,
      elementResolver,
      tools,
      context,
      browserService,
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

    const MAX_STEP_EXECUTIONS = 1000;
    let executionsRemaining = MAX_STEP_EXECUTIONS;
    let i = 0;

    while (i < steps.length) {
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
        i = nextIndex;
        continue;
      }

      i += 1;
    }

    // ------------------------------------------------------------------
    // 12. Close browser and collect video paths
    // ------------------------------------------------------------------
    try {
      const { videoPaths } = await browserService.close();
      for (const videoPath of videoPaths) {
        context.addArtifact(videoPath);
        logger.info({ videoPath }, 'Video recording saved');
      }
      logger.info('Browser closed');
    } catch (err) {
      logger.warn({ err }, 'Error closing browser (non-fatal)');
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
