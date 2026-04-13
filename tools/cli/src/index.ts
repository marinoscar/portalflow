#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import pino from 'pino';
import { AutomationSchema } from './schema/automation.schema.js';
import { ConfigService, type PathsConfig, type VideoConfig } from './config/config.service.js';
import { inferKind, type ProviderKind } from './llm/provider-kinds.js';
import { resolvePaths, resolveVideo } from './runner/paths.js';

function parseIntArg(v: string): number {
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) throw new Error(`Invalid integer: ${v}`);
  return n;
}

const logger = pino({ level: 'info' });
const program = new Command();

program
  .name('portalflow')
  .description('PortalFlow CLI — run and manage browser automations')
  .version('1.1.3')
  .action(async () => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    const bootstrap = await bootstrapDefaults();
    if (bootstrap.createdDirs.length > 0 || bootstrap.seededFiles.length > 0) {
      logger.info(
        {
          portalflowHome: bootstrap.portalflowHome,
          createdDirs: bootstrap.createdDirs,
          seededFiles: bootstrap.seededFiles,
        },
        'First-run setup: created default directories and seeded example automations',
      );
    }
    const { runMainTui } = await import('./tui/main-tui.js');
    await runMainTui();
  });

// run [file]
program
  .command('run [file]')
  .description('Execute an automation from a JSON file (omit file to use interactive TUI)')
  .option('--headless', 'Run browser in headless mode', false)
  .option('--video', 'Enable video recording of the browser session')
  .option('--no-video', 'Disable video recording even if enabled in config')
  .option('--video-dir <dir>', 'Directory to store recorded videos')
  .option('--screenshot-dir <dir>', 'Directory to store screenshots')
  .option('--download-dir <dir>', 'Directory to store downloaded files')
  .option('--automations-dir <dir>', 'Directory to look for automation files')
  .action(async (
    file: string | undefined,
    options: {
      headless: boolean;
      video?: boolean;
      videoDir?: string;
      screenshotDir?: string;
      downloadDir?: string;
      automationsDir?: string;
    },
  ) => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    const bootstrap = await bootstrapDefaults();
    if (bootstrap.createdDirs.length > 0 || bootstrap.seededFiles.length > 0) {
      logger.info(
        {
          portalflowHome: bootstrap.portalflowHome,
          createdDirs: bootstrap.createdDirs,
          seededFiles: bootstrap.seededFiles,
        },
        'First-run setup: created default directories and seeded example automations',
      );
    }
    if (!file) {
      const { runRunFlow } = await import('./tui/flows/run.js');
      await runRunFlow();
      return;
    }
    try {
      const { AutomationRunner } = await import('./runner/automation-runner.js');
      const runner = new AutomationRunner();
      const result = await runner.run(file, {
        headless: options.headless,
        video: options.video,
        videoDir: options.videoDir,
        screenshotDir: options.screenshotDir,
        downloadDir: options.downloadDir,
        automationsDir: options.automationsDir,
      });

      // Print summary to stdout
      if (result.success) {
        logger.info(
          {
            stepsCompleted: result.stepsCompleted,
            stepsTotal: result.stepsTotal,
            artifacts: result.artifacts.length,
            durationMs: result.completedAt.getTime() - result.startedAt.getTime(),
          },
          'Automation completed successfully',
        );
      } else {
        logger.error(
          {
            stepsCompleted: result.stepsCompleted,
            stepsTotal: result.stepsTotal,
            errors: result.errors,
          },
          'Automation completed with errors',
        );
        process.exitCode = 1;
      }
    } catch (err) {
      logger.error({ err }, 'Automation run failed');
      process.exit(1);
    }
  });

// validate [file]
program
  .command('validate [file]')
  .description('Validate an automation JSON file against the schema (omit file to use interactive TUI)')
  .action(async (file: string | undefined) => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    const bootstrap = await bootstrapDefaults();
    if (bootstrap.createdDirs.length > 0 || bootstrap.seededFiles.length > 0) {
      logger.info(
        {
          portalflowHome: bootstrap.portalflowHome,
          createdDirs: bootstrap.createdDirs,
          seededFiles: bootstrap.seededFiles,
        },
        'First-run setup: created default directories and seeded example automations',
      );
    }
    if (!file) {
      const { runValidateFlow } = await import('./tui/flows/validate.js');
      await runValidateFlow();
      return;
    }
    logger.info({ file }, 'Validating automation file');
    try {
      const raw = await readFile(file, 'utf-8');
      const json = JSON.parse(raw);
      const result = AutomationSchema.safeParse(json);
      if (!result.success) {
        logger.error({ errors: result.error.flatten() }, 'Validation failed');
        process.exitCode = 1;
      } else {
        logger.info({ id: result.data.id, name: result.data.name }, 'Validation passed');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to read or parse file');
      process.exit(1);
    }
  });

// provider
const provider = program
  .command('provider')
  .description('Manage LLM provider configuration (interactive TUI when run without subcommand)')
  .action(async () => {
    const { runProviderTui } = await import('./tui/provider-tui.js');
    await runProviderTui();
  });

provider
  .command('list')
  .description('List configured LLM providers')
  .action(async () => {
    const config = new ConfigService();
    const cfg = await config.load();
    const providers = Object.keys(cfg.providers ?? {});
    if (providers.length === 0) {
      logger.info('No providers configured');
    } else {
      const active = cfg.activeProvider ?? '(none)';
      for (const name of providers) {
        const prov = cfg.providers?.[name];
        const marker = name === active ? ' [active]' : '';
        const kind = inferKind(name, prov?.kind);
        const model = prov?.model ?? '(no model)';
        const baseUrlPart = kind === 'openai-compatible' && prov?.baseUrl ? `   baseUrl: ${prov.baseUrl}` : '';
        logger.info(`  ${name}${marker}   kind: ${kind}   model: ${model}${baseUrlPart}`);
      }
    }
  });

provider
  .command('set <name>')
  .description('Set the active LLM provider')
  .action(async (name: string) => {
    const config = new ConfigService();
    await config.setActiveProvider(name);
    logger.info({ provider: name }, 'Active provider updated');
  });

provider
  .command('config <name>')
  .description('Configure a provider')
  .option('--api-key <key>', 'API key for the provider')
  .option('--model <model>', 'Default model to use')
  .option('--base-url <url>', 'Base URL for the provider API')
  .option('--kind <kind>', 'Provider kind: anthropic or openai-compatible')
  .action(
    async (
      name: string,
      options: { apiKey?: string; model?: string; baseUrl?: string; kind?: string },
    ) => {
      const VALID_KINDS: ProviderKind[] = ['anthropic', 'openai-compatible'];
      if (options.kind !== undefined && !VALID_KINDS.includes(options.kind as ProviderKind)) {
        logger.error(
          { kind: options.kind },
          `Invalid --kind value. Must be one of: ${VALID_KINDS.join(', ')}`,
        );
        process.exit(1);
      }

      const config = new ConfigService();
      const cfg = await config.load();
      const existing = cfg.providers?.[name];

      // Determine kind: explicit flag > infer from name/existing config
      const resolvedKind: ProviderKind = options.kind
        ? (options.kind as ProviderKind)
        : inferKind(name, existing?.kind);

      const providerConfig: Record<string, string> = { kind: resolvedKind };
      if (options.apiKey) providerConfig['apiKey'] = options.apiKey;
      if (options.model) providerConfig['model'] = options.model;
      if (options.baseUrl) providerConfig['baseUrl'] = options.baseUrl;
      await config.setProviderConfig(name, providerConfig);
      logger.info({ provider: name, kind: resolvedKind }, 'Provider configuration saved');
    },
  );

provider
  .command('reset')
  .description('Remove all providers and the active selection (destructive)')
  .option('--yes', 'Skip confirmation prompt (required for non-interactive use)', false)
  .action(async (options: { yes: boolean }) => {
    const config = new ConfigService();
    const cfg = await config.load();
    const providerCount = Object.keys(cfg.providers ?? {}).length;

    if (providerCount === 0 && !cfg.activeProvider) {
      logger.info('Nothing to reset — no configuration exists yet');
      return;
    }

    if (!options.yes) {
      logger.error(
        'Refusing to reset without confirmation. Pass --yes to proceed, or run `portalflow provider` for the interactive TUI with a safer confirmation flow.',
      );
      process.exitCode = 1;
      return;
    }

    await config.reset();
    logger.info({ providersRemoved: providerCount }, 'All configurations removed');
  });

// settings
const settings = program
  .command('settings')
  .description('Manage storage paths and video recording (interactive TUI when run without subcommand)')
  .action(async () => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    const bootstrap = await bootstrapDefaults();
    if (bootstrap.createdDirs.length > 0 || bootstrap.seededFiles.length > 0) {
      logger.info(
        {
          portalflowHome: bootstrap.portalflowHome,
          createdDirs: bootstrap.createdDirs,
          seededFiles: bootstrap.seededFiles,
        },
        'First-run setup: created default directories and seeded example automations',
      );
    }
    const { runSettingsTui } = await import('./tui/settings-tui.js');
    await runSettingsTui();
  });

settings
  .command('list')
  .description('Show current storage paths and video recording settings')
  .action(async () => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    await bootstrapDefaults();
    const config = new ConfigService();
    const cfg = await config.load();
    const paths = resolvePaths(cfg);
    const video = resolveVideo(cfg);
    logger.info(paths, 'Paths');
    logger.info(video, 'Video');
  });

settings
  .command('paths')
  .description('Set storage paths (any subset of flags; omit all flags to show current values)')
  .option('--automations <dir>', 'Directory to look for automation files')
  .option('--screenshots <dir>', 'Directory to store screenshots')
  .option('--videos <dir>', 'Directory to store recorded videos')
  .option('--downloads <dir>', 'Directory to store downloaded files')
  .action(async (opts: {
    automations?: string;
    screenshots?: string;
    videos?: string;
    downloads?: string;
  }) => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    await bootstrapDefaults();
    const config = new ConfigService();
    const update: Partial<PathsConfig> = {};
    if (opts.automations) update.automations = opts.automations;
    if (opts.screenshots) update.screenshots = opts.screenshots;
    if (opts.videos) update.videos = opts.videos;
    if (opts.downloads) update.downloads = opts.downloads;
    if (Object.keys(update).length === 0) {
      const cfg = await config.load();
      const current = resolvePaths(cfg);
      logger.info(current, 'Current paths');
      return;
    }
    await config.setPaths(update);
    logger.info(update, 'Paths updated');
  });

settings
  .command('video')
  .description('Configure video recording of automation runs')
  .option('--enable', 'Enable video recording by default')
  .option('--disable', 'Disable video recording by default')
  .option('--width <n>', 'Video width in pixels', parseIntArg)
  .option('--height <n>', 'Video height in pixels', parseIntArg)
  .action(async (opts: {
    enable?: boolean;
    disable?: boolean;
    width?: number;
    height?: number;
  }) => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    await bootstrapDefaults();
    const config = new ConfigService();
    const update: Partial<VideoConfig> = {};
    if (opts.enable) update.enabled = true;
    if (opts.disable) update.enabled = false;
    if (opts.width !== undefined) update.width = opts.width;
    if (opts.height !== undefined) update.height = opts.height;
    if (Object.keys(update).length === 0) {
      const cfg = await config.load();
      const current = resolveVideo(cfg);
      logger.info(current, 'Current video config');
      return;
    }
    await config.setVideo(update);
    logger.info(update, 'Video config updated');
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'Unexpected error');
  process.exit(1);
});
