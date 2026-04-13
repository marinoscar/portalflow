import { readFile } from 'node:fs/promises';
import { AutomationSchema } from '@portalflow/schema';
import type { Automation, Step } from '@portalflow/schema';
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
import { createRunLogger } from './logger.js';
import { ConfigService } from '../config/config.service.js';
import { resolvePaths, resolveVideo } from './paths.js';

export interface RunOptions {
  headless?: boolean;
  video?: boolean;
  videoDir?: string;
  screenshotDir?: string;
  downloadDir?: string;
  automationsDir?: string;
}

const RETRY_BASE_DELAY_MS = 1_000;

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
    // 3. Create a pino logger
    // ------------------------------------------------------------------
    const logger = createRunLogger(automation.name);

    logger.info(
      { id: automation.id, name: automation.name, version: automation.version },
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

      switch (input.source ?? 'literal') {
        case 'env':
          resolved = input.value ? process.env[input.value] : process.env[input.name];
          break;

        case 'vaultcli': {
          if (!input.value) {
            logger.warn({ input: input.name }, 'vaultcli source requires a value (secret key); skipping');
            break;
          }
          try {
            const vaultResult = await vaultAdapter.getSecret(input.value);
            if (vaultResult.success) {
              resolved = vaultResult.output;
            } else {
              logger.warn(
                { input: input.name, error: vaultResult.error },
                'Failed to retrieve secret from vaultcli',
              );
            }
          } catch (err) {
            logger.warn({ input: input.name, err }, 'vaultcli call threw an error');
          }
          break;
        }

        case 'literal':
          resolved = input.value;
          break;

        case 'cli_arg':
          // Future: read from commander args; for now fall back to env
          resolved = input.value ? process.env[input.value] : process.env[input.name];
          if (!resolved) {
            logger.debug({ input: input.name }, 'cli_arg source: no value found in env (future feature)');
          }
          break;
      }

      if (resolved !== undefined) {
        context.setVariable(input.name, resolved);
        logger.debug({ input: input.name }, 'Input resolved and stored as context variable');
      } else if (input.required) {
        throw new Error(
          `Required input "${input.name}" could not be resolved (source: ${input.source ?? 'literal'}).`,
        );
      } else {
        logger.debug({ input: input.name }, 'Optional input not resolved; skipping');
      }
    }

    // ------------------------------------------------------------------
    // 6. Initialize LlmService
    // ------------------------------------------------------------------
    const llmService = new LlmService();
    try {
      await llmService.initialize();
    } catch (err) {
      logger.warn({ err: String(err) }, 'LLM service initialization failed — AI element resolution will not be available');
    }

    // ------------------------------------------------------------------
    // 7. Resolve effective paths and video config
    // ------------------------------------------------------------------
    const settings = automation.settings;
    const configService = new ConfigService();
    const userConfig = await configService.load();

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
    // 8. Launch BrowserService
    // ------------------------------------------------------------------
    const browserService = new BrowserService();

    const headless = options?.headless ?? settings?.headless ?? false;

    await browserService.launch({
      headless,
      viewport: settings?.viewport,
      userAgent: settings?.userAgent,
      screenshotDir: effectivePaths.screenshots,
      videoDir: effectivePaths.videos,
      downloadDir: effectivePaths.downloads,
      recordVideo: effectiveVideo.enabled,
      videoSize: { width: effectiveVideo.width, height: effectiveVideo.height },
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
    const stepExecutor = new StepExecutor(pageService, elementResolver, tools, context);

    const screenshotOnFailure = settings?.screenshotOnFailure ?? true;

    // ------------------------------------------------------------------
    // 11. Execute steps
    // ------------------------------------------------------------------
    const steps = automation.steps;

    for (const step of steps) {
      logger.info({ stepId: step.id, stepName: step.name, type: step.type }, 'Executing step');

      const success = await this.executeWithPolicy(
        step,
        stepExecutor,
        context,
        browserService,
        logger,
        screenshotOnFailure,
      );

      if (!success) {
        // abort policy — stop processing further steps
        break;
      }

      context.incrementCompleted();
      logger.info({ stepId: step.id, stepName: step.name }, 'Step completed');
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
      logger.warn({ err: String(err) }, 'Error closing browser (non-fatal)');
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

  // ---------------------------------------------------------------------------
  // Retry / skip / abort policy dispatcher
  // ---------------------------------------------------------------------------

  private async executeWithPolicy(
    step: Step,
    stepExecutor: StepExecutor,
    context: RunContext,
    browserService: BrowserService,
    logger: ReturnType<typeof createRunLogger>,
    screenshotOnFailure: boolean,
  ): Promise<boolean> {
    const policy = step.onFailure;
    const maxRetries = step.maxRetries;
    let attempts = 0;

    while (true) {
      try {
        await stepExecutor.execute(step);
        return true; // success
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts += 1;

        if (policy === 'retry' && attempts <= maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempts - 1);
          logger.warn(
            { stepId: step.id, attempt: attempts, maxRetries, delayMs: delay },
            `Step failed (attempt ${attempts}/${maxRetries}), retrying after ${delay}ms: ${message}`,
          );
          await sleep(delay);
          continue;
        }

        // Record the error
        context.addError(step.id, step.name, message);

        if (policy === 'skip') {
          logger.warn(
            { stepId: step.id, policy: 'skip' },
            `Step failed and will be skipped: ${message}`,
          );
          return true; // continue to next step
        }

        // abort (or retry exhausted)
        logger.error(
          { stepId: step.id, policy },
          `Step failed — aborting run: ${message}`,
        );

        if (screenshotOnFailure) {
          try {
            const screenshotPath = await browserService.screenshot(`failure_${step.id}`);
            context.addArtifact(screenshotPath);
            logger.info({ screenshotPath }, 'Failure screenshot captured');
          } catch (screenshotErr) {
            logger.warn({ err: String(screenshotErr) }, 'Failed to capture failure screenshot');
          }
        }

        return false; // stop execution
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
