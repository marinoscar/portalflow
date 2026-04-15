#!/usr/bin/env node
import { Command } from 'commander';
import * as helpText from './help-text.js';

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
  .name('portalflow2')
  .description('PortalFlow CLI v2 — executes browser automations via Chrome extension transport')
  .version('0.1.0')
  .addHelpText('after', helpText.topLevelHelpText())
  .action(() => {
    process.stdout.write(
      '\nportalflow2: interactive TUI not yet implemented (Task 2 of the cli2 rollout).\n' +
      'Run portalflow2 --help to see available subcommands.\n\n',
    );
    process.exit(0);
  });

// run [file]
program
  .command('run [file]')
  .description('Execute an automation from a JSON file (omit file to use interactive TUI)')
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
  .addHelpText('after', helpText.runHelpText())
  .action(async (file: string | undefined, opts: {
    video?: boolean;
    videoDir?: string;
    screenshotDir?: string;
    downloadDir?: string;
    automationsDir?: string;
    input?: string[];
    inputsJson?: string;
    logLevel?: string;
    stealth?: boolean;
    verbose?: boolean;
  }) => {
    if (!file) {
      process.stdout.write(
        '\nportalflow2 run: interactive TUI not yet implemented.\n' +
        'Usage: portalflow2 run <automation.json>\n\n',
      );
      process.exit(0);
    }

    // Parse --input key=value flags into a Map
    const inputs = new Map<string, string>();
    for (const kv of (opts.input ?? [])) {
      const eqIdx = kv.indexOf('=');
      if (eqIdx === -1) {
        process.stderr.write(`portalflow2: invalid --input format (expected key=value): "${kv}"\n`);
        process.exit(1);
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
        process.stderr.write(`portalflow2: --inputs-json is not valid JSON\n`);
        process.exit(1);
      }
    }

    const { AutomationRunner } = await import('./runner/automation-runner.js');
    const runner = new AutomationRunner();

    try {
      const result = await runner.run(file, {
        video: opts.video,
        videoDir: opts.videoDir,
        screenshotDir: opts.screenshotDir,
        downloadDir: opts.downloadDir,
        automationsDir: opts.automationsDir,
        inputs: inputs.size > 0 ? inputs : undefined,
        logLevel: opts.logLevel,
        verbose: opts.verbose,
      });

      if (!result.success) {
        process.exit(1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nportalflow2 run: ${msg}\n\n`);
      process.exit(1);
    }
  });

// validate [file]
program
  .command('validate [file]')
  .description('Validate an automation JSON file against the schema (omit file to use interactive TUI)')
  .addHelpText('after', helpText.validateHelpText())
  .action(() => {
    process.stdout.write(
      '\nvalidate is not yet implemented in portalflow2 (task 3 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

// provider
const provider = program
  .command('provider')
  .description('Manage LLM provider configuration (interactive TUI when run without subcommand)')
  .addHelpText('after', helpText.providerHelpText())
  .action(() => {
    process.stdout.write(
      '\nprovider is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

provider
  .command('list')
  .description('List configured LLM providers')
  .addHelpText('after', helpText.providerListHelpText())
  .action(() => {
    process.stdout.write(
      '\nprovider list is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

provider
  .command('set <name>')
  .description('Set the active LLM provider')
  .addHelpText('after', helpText.providerSetHelpText())
  .action(() => {
    process.stdout.write(
      '\nprovider set is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

provider
  .command('config <name>')
  .description('Configure a provider')
  .option('--api-key <key>', 'API key for the provider')
  .option('--model <model>', 'Default model to use')
  .option('--base-url <url>', 'Base URL for the provider API')
  .option('--kind <kind>', 'Provider kind: anthropic or openai-compatible')
  .addHelpText('after', helpText.providerConfigHelpText())
  .action(() => {
    process.stdout.write(
      '\nprovider config is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

provider
  .command('reset')
  .description('Remove all providers and the active selection (destructive)')
  .option('--yes', 'Skip confirmation prompt (required for non-interactive use)', false)
  .addHelpText('after', helpText.providerResetHelpText())
  .action(() => {
    process.stdout.write(
      '\nprovider reset is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

// settings
const settings = program
  .command('settings')
  .description('Manage storage paths and video recording (interactive TUI when run without subcommand)')
  .addHelpText('after', helpText.settingsHelpText())
  .action(() => {
    process.stdout.write(
      '\nsettings is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

settings
  .command('list')
  .description('Show current storage paths and video recording settings')
  .addHelpText('after', helpText.settingsListHelpText())
  .action(() => {
    process.stdout.write(
      '\nsettings list is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

settings
  .command('paths')
  .description('Set storage paths (any subset of flags; omit all flags to show current values)')
  .option('--automations <dir>', 'Directory to look for automation files')
  .option('--screenshots <dir>', 'Directory to store screenshots')
  .option('--videos <dir>', 'Directory to store recorded videos')
  .option('--downloads <dir>', 'Directory to store downloaded files')
  .addHelpText('after', helpText.settingsPathsHelpText())
  .action(() => {
    process.stdout.write(
      '\nsettings paths is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
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
  .action(() => {
    process.stdout.write(
      '\nsettings logging is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
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
  .action(() => {
    process.stdout.write(
      '\nsettings browser is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

settings
  .command('video')
  .description('Configure video recording of automation runs')
  .option('--enable', 'Enable video recording by default')
  .option('--disable', 'Disable video recording by default')
  .option('--width <n>', 'Video width in pixels', parseIntArg)
  .option('--height <n>', 'Video height in pixels', parseIntArg)
  .addHelpText('after', helpText.settingsVideoHelpText())
  .action(() => {
    process.stdout.write(
      '\nsettings video is not yet implemented in portalflow2 (task 4 of the cli2 rollout)\n\n',
    );
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nportalflow2: unexpected error: ${msg}\n\n`);
  process.exit(1);
});
