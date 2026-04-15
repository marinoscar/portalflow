#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import pino from 'pino';
import { AutomationSchema } from '@portalflow/schema';
import {
  ConfigService,
  type BrowserChannel,
  type BrowserConfig,
  type BrowserMode,
  type LogLevel,
  type LoggingConfig,
  type PathsConfig,
  type VideoConfig,
} from './config/config.service.js';
import { inferKind, type ProviderKind } from './llm/provider-kinds.js';
import { resolvePaths, resolveVideo } from './runner/paths.js';
import * as helpText from './help-text.js';

function parseIntArg(v: string): number {
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) throw new Error(`Invalid integer: ${v}`);
  return n;
}

const logger = pino({ level: 'info' });
const program = new Command();

program
  .configureHelp({
    sortSubcommands: false,
    sortOptions: false,
    showGlobalOptions: true,
  })
  .showSuggestionAfterError(true)
  .showHelpAfterError('(use --help for more information)');

program
  .name('portalflow')
  .description('PortalFlow CLI — run and manage browser automations')
  .version('1.1.15')
  .addHelpText('after', helpText.topLevelHelpText())
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
  .option(
    '--input <kv>',
    'Pass an input value as key=value (repeatable)',
    (val: string, prev: string[] = []) => [...prev, val],
    [] as string[],
  )
  .option(
    '--inputs-json <json>',
    'Pass multiple input values as a JSON object',
  )
  .option(
    '-l, --log-level <level>',
    'Log verbosity: trace, debug, info, warn, error, fatal, silent (overrides LOG_LEVEL and config)',
  )
  .option(
    '--browser-mode <mode>',
    'Browser mode: "isolated" (fresh in-memory) or "persistent" (real on-disk profile). Overrides config.',
  )
  .option(
    '--browser-channel <channel>',
    'Chromium-family channel: chromium, chrome, chrome-beta, chrome-dev, msedge, msedge-beta, msedge-dev. Persistent mode only.',
  )
  .option(
    '--browser-user-data-dir <path>',
    'Path to the user data directory. Required for persistent mode.',
  )
  .option(
    '--browser-profile-directory <name>',
    'Sub-profile inside the user data directory (e.g. "Default", "Profile 1").',
  )
  .option(
    '-v, --verbose',
    'Print the full pino log stream to stdout (disables the clean presenter view). Useful for debugging the runner itself.',
    false,
  )
  .addHelpText('after', helpText.runHelpText())
  .action(async (
    file: string | undefined,
    options: {
      headless: boolean;
      video?: boolean;
      videoDir?: string;
      screenshotDir?: string;
      downloadDir?: string;
      automationsDir?: string;
      input?: string[];
      inputsJson?: string;
      logLevel?: string;
      browserMode?: string;
      browserChannel?: string;
      browserUserDataDir?: string;
      browserProfileDirectory?: string;
      verbose?: boolean;
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
    // Build inputOverrides map: --inputs-json first (lower priority),
    // then --input pairs (higher priority — more explicit per-value flag).
    const inputOverrides = new Map<string, string>();
    if (options.inputsJson) {
      try {
        const parsed = JSON.parse(options.inputsJson);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('--inputs-json must be a JSON object');
        }
        for (const [k, v] of Object.entries(parsed)) {
          inputOverrides.set(k, String(v));
        }
      } catch (err) {
        logger.error({ err: String(err) }, 'Failed to parse --inputs-json');
        process.exit(1);
      }
    }
    for (const pair of options.input ?? []) {
      const idx = pair.indexOf('=');
      if (idx < 0) {
        logger.error({ pair }, 'Invalid --input value, expected key=value');
        process.exit(1);
      }
      inputOverrides.set(pair.slice(0, idx), pair.slice(idx + 1));
    }

    if (!file) {
      const { runRunFlow } = await import('./tui/flows/run.js');
      await runRunFlow();
      return;
    }
    try {
      const { AutomationRunner } = await import('./runner/automation-runner.js');
      const runner = new AutomationRunner();
      // Validate --browser-mode if provided
      if (options.browserMode && !['isolated', 'persistent'].includes(options.browserMode)) {
        logger.error(
          { browserMode: options.browserMode },
          'Invalid --browser-mode value. Must be "isolated" or "persistent".',
        );
        process.exit(1);
      }

      const result = await runner.run(file, {
        headless: options.headless,
        video: options.video,
        videoDir: options.videoDir,
        screenshotDir: options.screenshotDir,
        downloadDir: options.downloadDir,
        automationsDir: options.automationsDir,
        inputs: inputOverrides.size > 0 ? inputOverrides : undefined,
        logLevel: options.logLevel,
        browserMode: options.browserMode as 'isolated' | 'persistent' | undefined,
        browserChannel: options.browserChannel,
        browserUserDataDir: options.browserUserDataDir,
        browserProfileDirectory: options.browserProfileDirectory,
        verbose: options.verbose,
      });

      // In the default presenter view the runner already printed a
      // clean summary to stdout via RunPresenter.runEnd. Only print
      // an additional pino line when --verbose is on so the user
      // still sees a structured final event in the log stream.
      if (options.verbose) {
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
        }
      }

      if (!result.success) process.exitCode = 1;
    } catch (err) {
      // In presenter mode the RunPresenter has already shown a clean
      // failure line via runEnd/runFatal; in verbose mode pino will
      // print the structured error. Either way, set exit 1.
      if (options.verbose) {
        logger.error({ err }, 'Automation run failed');
      } else {
        // The runner may have failed before it constructed a presenter
        // (e.g. file read / schema validation). Print a minimal
        // human-readable line so the user isn't left with nothing.
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\n✗ run failed: ${msg}\n\n`);
      }
      process.exit(1);
    }
  });

// validate [file]
program
  .command('validate [file]')
  .description('Validate an automation JSON file against the schema (omit file to use interactive TUI)')
  .addHelpText('after', helpText.validateHelpText())
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
  .addHelpText('after', helpText.providerHelpText())
  .action(async () => {
    const { runProviderTui } = await import('./tui/provider-tui.js');
    await runProviderTui();
  });

provider
  .command('list')
  .description('List configured LLM providers')
  .addHelpText('after', helpText.providerListHelpText())
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
  .addHelpText('after', helpText.providerSetHelpText())
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
  .addHelpText('after', helpText.providerConfigHelpText())
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
  .addHelpText('after', helpText.providerResetHelpText())
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
  .addHelpText('after', helpText.settingsHelpText())
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
  .addHelpText('after', helpText.settingsListHelpText())
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
  .addHelpText('after', helpText.settingsPathsHelpText())
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
  .command('logging')
  .description('Configure logging for automation runs')
  .option(
    '-l, --level <level>',
    'Log level: trace, debug, info, warn, error, fatal, silent',
  )
  .option('--file <path>', 'Write logs to this file in addition to stdout')
  .option('--no-file', 'Disable file logging (stdout only)')
  .option('--pretty', 'Pretty-print stdout logs (colorized, human-readable)')
  .option('--no-pretty', 'Disable pretty-printing (raw JSON to stdout)')
  .option('--redact', 'Redact secrets and sensitive fields in log output')
  .option('--no-redact', 'Do NOT redact secret values (use with care)')
  .addHelpText('after', helpText.settingsLoggingHelpText())
  .action(async (opts: {
    level?: string;
    file?: string | false;
    pretty?: boolean;
    redact?: boolean;
  }) => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    await bootstrapDefaults();
    const config = new ConfigService();

    const VALID: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
    if (opts.level !== undefined && !VALID.includes(opts.level as LogLevel)) {
      logger.error(
        { level: opts.level },
        `Invalid --level value. Must be one of: ${VALID.join(', ')}`,
      );
      process.exit(1);
    }

    const update: Partial<LoggingConfig> = {};
    if (opts.level !== undefined) update.level = opts.level as LogLevel;
    if (opts.file === false) update.file = '';
    if (typeof opts.file === 'string') update.file = opts.file;
    if (opts.pretty !== undefined) update.pretty = opts.pretty;
    if (opts.redact !== undefined) update.redactSecrets = opts.redact;

    if (Object.keys(update).length === 0) {
      const cfg = await config.load();
      const current = cfg.logging ?? {};
      logger.info(current, 'Current logging config');
      return;
    }

    // Empty string means "clear the file setting".
    if (update.file === '') {
      const cfg = await config.load();
      cfg.logging = { ...(cfg.logging ?? {}) };
      delete cfg.logging.file;
      // Also merge any other fields from `update` except `file`.
      if (update.level !== undefined) cfg.logging.level = update.level;
      if (update.pretty !== undefined) cfg.logging.pretty = update.pretty;
      if (update.redactSecrets !== undefined) cfg.logging.redactSecrets = update.redactSecrets;
      await config.save(cfg);
      logger.info({ ...cfg.logging, file: null }, 'Logging config updated (file disabled)');
      return;
    }

    await config.setLogging(update);
    logger.info(update, 'Logging config updated');
  });

settings
  .command('browser')
  .description('Configure the browser profile used for automation runs')
  .option('--mode <mode>', '"isolated" or "persistent"')
  .option('--channel <channel>', 'Chromium-family channel: chromium, chrome, chrome-beta, chrome-dev, msedge, msedge-beta, msedge-dev')
  .option('--user-data-dir <path>', 'Path to the user data directory')
  .option('--profile-directory <name>', 'Sub-profile name (e.g. "Default", "Profile 1")')
  .option('--list', 'List installed Chromium-family browser profiles on this machine and exit')
  .addHelpText('after', helpText.settingsBrowserHelpText())
  .action(async (opts: {
    mode?: string;
    channel?: string;
    userDataDir?: string;
    profileDirectory?: string;
    list?: boolean;
  }) => {
    const { bootstrapDefaults } = await import('./runner/bootstrap.js');
    await bootstrapDefaults();

    if (opts.list) {
      const { discoverBrowserProfiles, formatProfileLine } = await import(
        './browser/profile-inspector.js'
      );
      const profiles = discoverBrowserProfiles();
      if (profiles.length === 0) {
        logger.info('No Chromium-family browser profiles found on this machine.');
        return;
      }
      logger.info({ count: profiles.length }, 'Discovered browser profiles:');
      for (const p of profiles) {
        logger.info(`  ${formatProfileLine(p)}`);
        logger.info(`    user-data-dir:     ${p.userDataDir}`);
        logger.info(`    profile-directory: ${p.profileDirectory}`);
        logger.info(`    channel:           ${p.channel}`);
      }
      return;
    }

    const config = new ConfigService();

    const VALID_MODES: BrowserMode[] = ['isolated', 'persistent'];
    if (opts.mode !== undefined && !VALID_MODES.includes(opts.mode as BrowserMode)) {
      logger.error(
        { mode: opts.mode },
        `Invalid --mode value. Must be one of: ${VALID_MODES.join(', ')}`,
      );
      process.exit(1);
    }

    const VALID_CHANNELS: BrowserChannel[] = [
      'chromium',
      'chrome',
      'chrome-beta',
      'chrome-dev',
      'msedge',
      'msedge-beta',
      'msedge-dev',
    ];
    if (opts.channel !== undefined && !VALID_CHANNELS.includes(opts.channel as BrowserChannel)) {
      logger.error(
        { channel: opts.channel },
        `Invalid --channel value. Must be one of: ${VALID_CHANNELS.join(', ')}`,
      );
      process.exit(1);
    }

    const update: Partial<BrowserConfig> = {};
    if (opts.mode !== undefined) update.mode = opts.mode as BrowserMode;
    if (opts.channel !== undefined) update.channel = opts.channel as BrowserChannel;
    if (opts.userDataDir !== undefined) update.userDataDir = opts.userDataDir;
    if (opts.profileDirectory !== undefined) {
      update.profileDirectory = opts.profileDirectory;
    }

    if (Object.keys(update).length === 0) {
      const cfg = await config.load();
      const current = cfg.browser ?? {};
      logger.info(current, 'Current browser config');
      return;
    }

    // Switching back to isolated mode wipes the persistent fields so the
    // config doesn't accumulate stale values that the runtime ignores.
    if (update.mode === 'isolated') {
      const cfg = await config.load();
      cfg.browser = { mode: 'isolated' };
      await config.save(cfg);
      logger.info(cfg.browser, 'Browser config updated (switched to isolated mode)');
      return;
    }

    await config.setBrowser(update);
    logger.info(update, 'Browser config updated');
  });

settings
  .command('video')
  .description('Configure video recording of automation runs')
  .option('--enable', 'Enable video recording by default')
  .option('--disable', 'Disable video recording by default')
  .option('--width <n>', 'Video width in pixels', parseIntArg)
  .option('--height <n>', 'Video height in pixels', parseIntArg)
  .addHelpText('after', helpText.settingsVideoHelpText())
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
