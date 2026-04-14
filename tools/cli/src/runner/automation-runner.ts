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
import { createRunLogger, resolveLoggingConfig } from './logger.js';
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
    const logger = createRunLogger(automation.name, loggingConfig);

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
    );

    // ------------------------------------------------------------------
    // 11. Execute steps
    // ------------------------------------------------------------------
    const steps = automation.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      logger.info(
        {
          stepId: step.id,
          stepName: step.name,
          type: step.type,
          index: i + 1,
          total: steps.length,
        },
        'Executing step',
      );

      const success = await stepExecutor.executeWithPolicy(step);

      if (!success) {
        // abort policy — stop processing further steps
        break;
      }

      context.incrementCompleted();
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

    return result;
  }

}
