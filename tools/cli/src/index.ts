#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import * as helpText from './help-text.js';
import {
  ConfigService,
  type LogLevel,
  type LoggingConfig,
  type PathsConfig,
  type VideoConfig,
} from './config/config.service.js';
import { inferKind, type ProviderKind } from './llm/provider-kinds.js';
import { resolvePaths, resolveVideo } from './runner/paths.js';
import { ExitCodes, exitCodeForError, type ExitCode } from './exit-codes.js';

// Read the CLI version from package.json at startup so `--version` can never
// drift from the published package. Works in both the built dist layout
// (dist/index.js → ../package.json) and under tsx dev (src/index.ts →
// ../package.json). Reading once at module load is fine — this file is the
// CLI entry point and runs exactly once per invocation.
const __dirname = dirname(fileURLToPath(import.meta.url));
const { version: CLI_VERSION } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
) as { version: string };

function parseIntArg(v: string): number {
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) throw new Error(`Invalid integer: ${v}`);
  return n;
}

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
  .description('PortalFlow CLI — executes browser automations via Chrome extension transport')
  .version(CLI_VERSION)
  .addHelpText('after', helpText.topLevelHelpText())
  .action(async () => {
    const { runMainTui } = await import('./tui/main-tui.js');
    await runMainTui();
  });

// ---------------------------------------------------------------------------
// run [file]
// ---------------------------------------------------------------------------
program
  .command('run [file]')
  .description('Execute an automation from a JSON file (omit file to use interactive TUI)')
  .option('--video', 'Enable video recording of the browser session')
  .option('--no-video', 'Disable video recording even if enabled in config')
  .option('--video-dir <dir>', 'Directory to store recorded videos')
  .option('--screenshot-dir <dir>', 'Directory to store screenshots')
  .option('--download-dir <dir>', 'Directory to store downloaded files')
  .option('--html-dir <dir>', 'Directory to store extracted HTML files (extract saveToFile)')
  .option('--automations-dir <dir>', 'Directory to look for automation files')
  .option(
    '--input <kv>',
    'Pass an input value as key=value (repeatable)',
    (val: string, prev: string[] = []) => [...prev, val],
    [] as string[],
  )
  .option('--inputs-json <json>', 'Pass multiple input values as a JSON object')
  .option(
    '-l, --log-level <level>',
    'Log verbosity: trace, debug, info, warn, error, fatal, silent (overrides LOG_LEVEL and config)',
  )
  .option(
    '--stealth',
    'Apply anti-detection patches to the browser session. Opt-in.',
    false,
  )
  .option(
    '-v, --verbose',
    'Print the full pino log stream to stdout. Useful for debugging the runner itself.',
    false,
  )
  .option(
    '--no-color',
    'Disable ANSI color codes in presenter output (also honors NO_COLOR env var and non-TTY stdout)',
  )
  .option(
    '--json',
    'Agent mode: suppress presenter, redirect logs to file, emit a single RunResult JSON document on stdout. See docs/AGENT-INTEGRATION.md for the wire shape.',
    false,
  )
  .option('--kill-chrome', 'Close all existing Chrome instances before launching', false)
  .option(
    '--clear-history <range>',
    'Clear browsing history and cache before running. Ranges: none, last15min, last1hour, last24hour, last7days, all',
    'none',
  )
  .addHelpText('after', helpText.runHelpText())
  .action(async (file: string | undefined, opts: {
    video?: boolean;
    videoDir?: string;
    screenshotDir?: string;
    downloadDir?: string;
    htmlDir?: string;
    automationsDir?: string;
    input?: string[];
    inputsJson?: string;
    logLevel?: string;
    stealth?: boolean;
    verbose?: boolean;
    color?: boolean;
    json?: boolean;
    killChrome?: boolean;
    clearHistory?: string;
  }) => {
    if (!file) {
      const { runRunFlow } = await import('./tui/flows/run.js');
      await runRunFlow();
      return;
    }

    // Helper: emit a structured failure on stdout in --json mode, instead
    // of a stderr message + bare exit. Keeps the agent's stdout the single
    // source of truth for run outcomes (success or pre-flight failure).
    const failJson = (code: ExitCode, message: string): never => {
      process.stdout.write(
        JSON.stringify({ success: false, error: message, exitCode: code }) + '\n',
      );
      process.exit(code);
    };

    // Parse --input key=value flags into a Map
    const inputs = new Map<string, string>();
    for (const kv of (opts.input ?? [])) {
      const eqIdx = kv.indexOf('=');
      if (eqIdx === -1) {
        const msg = `invalid --input format (expected key=value): "${kv}"`;
        if (opts.json) failJson(ExitCodes.Runtime, msg);
        process.stderr.write(`portalflow: ${msg}\n`);
        process.exit(ExitCodes.Runtime);
      }
      inputs.set(kv.slice(0, eqIdx), kv.slice(eqIdx + 1));
    }
    if (opts.inputsJson) {
      try {
        const obj = JSON.parse(opts.inputsJson) as Record<string, string>;
        for (const [k, v] of Object.entries(obj)) {
          inputs.set(k, v);
        }
      } catch {
        const msg = '--inputs-json is not valid JSON';
        if (opts.json) failJson(ExitCodes.Runtime, msg);
        process.stderr.write(`portalflow: ${msg}\n`);
        process.exit(ExitCodes.Runtime);
      }
    }

    // Ensure profile choice before running non-interactively
    const configService = new ConfigService();
    const config = await configService.load();
    const extension = config.extension;
    if (!extension || extension.profileMode === 'unset') {
      const msg =
        'Chrome profile mode is not configured. ' +
        'Run `portalflow` (interactive TUI) or `portalflow settings extension` to configure it first.';
      if (opts.json) failJson(ExitCodes.Runtime, msg);
      process.stderr.write(`\nportalflow: ${msg}\n\n`);
      process.exit(ExitCodes.Runtime);
    }

    const { AutomationRunner } = await import('./runner/automation-runner.js');
    const runner = new AutomationRunner();

    try {
      const result = await runner.run(file, {
        video: opts.video,
        videoDir: opts.videoDir,
        screenshotDir: opts.screenshotDir,
        downloadDir: opts.downloadDir,
        htmlDir: opts.htmlDir,
        automationsDir: opts.automationsDir,
        inputs: inputs.size > 0 ? inputs : undefined,
        logLevel: opts.logLevel,
        verbose: opts.verbose,
        noColor: opts.color === false,
        json: opts.json,
        killChrome: opts.killChrome,
        clearHistory: opts.clearHistory as import('./browser/protocol.js').ClearBrowsingDataRange | undefined,
      });

      if (opts.json) {
        process.stdout.write(JSON.stringify(result) + '\n');
      }
      if (!result.success) {
        process.exit(ExitCodes.Runtime);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = exitCodeForError(err);
      if (opts.json) failJson(code, msg);
      process.stderr.write(`\nportalflow run: ${msg}\n\n`);
      process.exit(code);
    }
  });

// ---------------------------------------------------------------------------
// validate [file]
// ---------------------------------------------------------------------------
program
  .command('validate [file]')
  .description('Validate an automation JSON file against the schema (omit file to use interactive TUI)')
  .addHelpText('after', helpText.validateHelpText())
  .action(async (file: string | undefined) => {
    if (!file) {
      const { runValidateFlow } = await import('./tui/flows/validate.js');
      await runValidateFlow();
      return;
    }

    const { readFile } = await import('node:fs/promises');
    const { AutomationSchema } = await import('@portalflow/schema');

    try {
      const raw = await readFile(file, 'utf-8');
      const json = JSON.parse(raw);
      const result = AutomationSchema.safeParse(json);
      if (!result.success) {
        process.stderr.write(
          `portalflow validate: schema validation failed\n${JSON.stringify(result.error.flatten(), null, 2)}\n`,
        );
        process.exitCode = ExitCodes.Schema;
      } else {
        process.stdout.write(
          `portalflow validate: OK — ${result.data.name} (${result.data.steps.length} steps)\n`,
        );
      }
    } catch (err) {
      process.stderr.write(`portalflow validate: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------
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
      process.stdout.write('No providers configured\n');
    } else {
      const active = cfg.activeProvider ?? '(none)';
      for (const name of providers) {
        const prov = cfg.providers?.[name];
        const marker = name === active ? ' [active]' : '';
        const kind = inferKind(name, prov?.kind);
        const model = prov?.model ?? '(no model)';
        const baseUrlPart =
          kind === 'openai-compatible' && prov?.baseUrl ? `   baseUrl: ${prov.baseUrl}` : '';
        process.stdout.write(`  ${name}${marker}   kind: ${kind}   model: ${model}${baseUrlPart}\n`);
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
    process.stdout.write(`Active provider set to: ${name}\n`);
  });

provider
  .command('config <name>')
  .description('Configure a provider')
  .option('--api-key <key>', 'API key for the provider')
  .option('--model <model>', 'Default model to use')
  .option('--base-url <url>', 'Base URL for the provider API')
  .option('--kind <kind>', 'Provider kind: anthropic or openai-compatible')
  .addHelpText('after', helpText.providerConfigHelpText())
  .action(async (
    name: string,
    options: { apiKey?: string; model?: string; baseUrl?: string; kind?: string },
  ) => {
    const VALID_KINDS: ProviderKind[] = ['anthropic', 'openai-compatible'];
    if (options.kind !== undefined && !VALID_KINDS.includes(options.kind as ProviderKind)) {
      process.stderr.write(
        `portalflow: invalid --kind value. Must be one of: ${VALID_KINDS.join(', ')}\n`,
      );
      process.exit(1);
    }

    const config = new ConfigService();
    const cfg = await config.load();
    const existing = cfg.providers?.[name];

    const resolvedKind: ProviderKind = options.kind
      ? (options.kind as ProviderKind)
      : inferKind(name, existing?.kind);

    const providerConfig: Record<string, string> = { kind: resolvedKind };
    if (options.apiKey) providerConfig['apiKey'] = options.apiKey;
    if (options.model) providerConfig['model'] = options.model;
    if (options.baseUrl) providerConfig['baseUrl'] = options.baseUrl;
    await config.setProviderConfig(name, providerConfig);
    process.stdout.write(`Provider ${name} configured (kind: ${resolvedKind})\n`);
  });

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
      process.stdout.write('Nothing to reset — no configuration exists yet\n');
      return;
    }

    if (!options.yes) {
      process.stderr.write(
        'Refusing to reset without confirmation. Pass --yes to proceed, or run ' +
        '`portalflow provider` for the interactive TUI with a safer confirmation flow.\n',
      );
      process.exitCode = 1;
      return;
    }

    await config.reset();
    process.stdout.write(`All configurations removed (${providerCount} provider(s))\n`);
  });

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
const settings = program
  .command('settings')
  .description('Manage storage paths, video recording, and extension config (interactive TUI when run without subcommand)')
  .addHelpText('after', helpText.settingsHelpText())
  .action(async () => {
    const { runSettingsTui } = await import('./tui/settings-tui.js');
    await runSettingsTui();
  });

settings
  .command('list')
  .description('Show current settings (paths, video, logging, extension)')
  .addHelpText('after', helpText.settingsListHelpText())
  .action(async () => {
    const config = new ConfigService();
    const cfg = await config.load();
    const paths = resolvePaths(cfg);
    const video = resolveVideo(cfg);
    const logging = cfg.logging ?? {};
    const extension = cfg.extension;

    process.stdout.write('Paths:\n');
    process.stdout.write(`  automations:  ${paths.automations}\n`);
    process.stdout.write(`  screenshots:  ${paths.screenshots}\n`);
    process.stdout.write(`  videos:       ${paths.videos}\n`);
    process.stdout.write(`  downloads:    ${paths.downloads}\n`);
    process.stdout.write('\nVideo:\n');
    process.stdout.write(`  enabled: ${video.enabled}\n`);
    process.stdout.write(`  width:   ${video.width}\n`);
    process.stdout.write(`  height:  ${video.height}\n`);
    process.stdout.write('\nLogging:\n');
    process.stdout.write(`  level:          ${logging.level ?? 'info (default)'}\n`);
    process.stdout.write(`  file:           ${logging.file ?? '(none — stdout only)'}\n`);
    process.stdout.write(`  pretty:         ${logging.pretty ?? true ? 'yes' : 'no'}\n`);
    process.stdout.write(`  redactSecrets:  ${logging.redactSecrets ?? true ? 'yes' : 'no'}\n`);
    process.stdout.write('\nExtension:\n');
    process.stdout.write(`  host:               ${extension?.host ?? '127.0.0.1'}\n`);
    process.stdout.write(`  port:               ${extension?.port ?? 7667}\n`);
    process.stdout.write(`  profileMode:        ${extension?.profileMode ?? 'unset'}\n`);
    process.stdout.write(`  profileDir:         ${extension?.profileDir ?? '(n/a)'}\n`);
    process.stdout.write(`  closeOnFinish:      ${extension?.closeWindowOnFinish ? 'yes' : 'no'}\n`);
    process.stdout.write(`  chromeBinary:       ${extension?.chromeBinary ?? '(auto-detect)'}\n`);
  });

settings
  .command('paths')
  .description('Set storage paths (any subset of flags; omit all flags to show current values)')
  .option('--automations <dir>', 'Directory to look for automation files')
  .option('--screenshots <dir>', 'Directory to store screenshots')
  .option('--videos <dir>', 'Directory to store recorded videos')
  .option('--downloads <dir>', 'Directory to store downloaded files')
  .option('--html <dir>', 'Directory to store extracted HTML files (extract saveToFile)')
  .addHelpText('after', helpText.settingsPathsHelpText())
  .action(async (opts: {
    automations?: string;
    screenshots?: string;
    videos?: string;
    downloads?: string;
    html?: string;
  }) => {
    const config = new ConfigService();
    const update: Partial<PathsConfig> = {};
    if (opts.automations) update.automations = opts.automations;
    if (opts.screenshots) update.screenshots = opts.screenshots;
    if (opts.videos) update.videos = opts.videos;
    if (opts.downloads) update.downloads = opts.downloads;
    if (opts.html) update.html = opts.html;
    if (Object.keys(update).length === 0) {
      const cfg = await config.load();
      const current = resolvePaths(cfg);
      process.stdout.write(`automations:  ${current.automations}\n`);
      process.stdout.write(`screenshots:  ${current.screenshots}\n`);
      process.stdout.write(`videos:       ${current.videos}\n`);
      process.stdout.write(`downloads:    ${current.downloads}\n`);
      process.stdout.write(`html:         ${current.html}\n`);
      return;
    }
    await config.setPaths(update);
    process.stdout.write(`Paths updated: ${JSON.stringify(update)}\n`);
  });

settings
  .command('logging')
  .description('Configure logging for automation runs')
  .option('-l, --level <level>', 'Log level: trace, debug, info, warn, error, fatal, silent')
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
    const config = new ConfigService();

    const VALID: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
    if (opts.level !== undefined && !VALID.includes(opts.level as LogLevel)) {
      process.stderr.write(
        `portalflow: invalid --level value. Must be one of: ${VALID.join(', ')}\n`,
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
      process.stdout.write(JSON.stringify(current, null, 2) + '\n');
      return;
    }

    // Empty string means "clear the file setting".
    if (update.file === '') {
      const cfg = await config.load();
      cfg.logging = { ...(cfg.logging ?? {}) };
      delete cfg.logging.file;
      if (update.level !== undefined) cfg.logging.level = update.level;
      if (update.pretty !== undefined) cfg.logging.pretty = update.pretty;
      if (update.redactSecrets !== undefined) cfg.logging.redactSecrets = update.redactSecrets;
      await config.save(cfg);
      process.stdout.write('Logging config updated (file disabled)\n');
      return;
    }

    await config.setLogging(update);
    process.stdout.write(`Logging config updated: ${JSON.stringify(update)}\n`);
  });

settings
  .command('extension')
  .description('Configure the Chrome extension transport (profile mode, host, port)')
  .addHelpText('after', helpText.settingsBrowserHelpText())
  .action(async () => {
    const config = new ConfigService();
    const { runExtensionSettings } = await import('./tui/flows/settings-extension.js');
    await runExtensionSettings(config);
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
    const config = new ConfigService();
    const update: Partial<VideoConfig> = {};
    if (opts.enable) update.enabled = true;
    if (opts.disable) update.enabled = false;
    if (opts.width !== undefined) update.width = opts.width;
    if (opts.height !== undefined) update.height = opts.height;
    if (Object.keys(update).length === 0) {
      const cfg = await config.load();
      const current = resolveVideo(cfg);
      process.stdout.write(JSON.stringify(current, null, 2) + '\n');
      return;
    }
    await config.setVideo(update);
    process.stdout.write(`Video config updated: ${JSON.stringify(update)}\n`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nportalflow: unexpected error: ${msg}\n\n`);
  process.exit(1);
});
