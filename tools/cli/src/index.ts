#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import pino from 'pino';
import { AutomationSchema } from './schema/automation.schema.js';
import { ConfigService } from './config/config.service.js';
import { inferKind, type ProviderKind } from './llm/provider-kinds.js';

const logger = pino({ level: 'info' });
const program = new Command();

program
  .name('portalflow')
  .description('PortalFlow CLI — run and manage browser automations')
  .version('1.1.2')
  .action(async () => {
    const { runMainTui } = await import('./tui/main-tui.js');
    await runMainTui();
  });

// run [file]
program
  .command('run [file]')
  .description('Execute an automation from a JSON file (omit file to use interactive TUI)')
  .option('--headless', 'Run browser in headless mode', false)
  .action(async (file: string | undefined, options: { headless: boolean }) => {
    if (!file) {
      const { runRunFlow } = await import('./tui/flows/run.js');
      await runRunFlow();
      return;
    }
    try {
      const { AutomationRunner } = await import('./runner/automation-runner.js');
      const runner = new AutomationRunner();
      const result = await runner.run(file, { headless: options.headless });

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

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'Unexpected error');
  process.exit(1);
});
