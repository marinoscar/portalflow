#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import pino from 'pino';
import { AutomationSchema } from './schema/automation.schema.js';
import { ConfigService } from './config/config.service.js';

const logger = pino({ level: 'info' });
const program = new Command();

program
  .name('portalflow')
  .description('PortalFlow CLI — run and manage browser automations')
  .version('1.1.1');

// run <file>
program
  .command('run <file>')
  .description('Execute an automation from a JSON file')
  .option('--headless', 'Run browser in headless mode', false)
  .action(async (file: string, options: { headless: boolean }) => {
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

// validate <file>
program
  .command('validate <file>')
  .description('Validate an automation JSON file against the schema')
  .action(async (file: string) => {
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
        const marker = name === active ? ' [active]' : '';
        logger.info(`  ${name}${marker}`);
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
  .action(async (name: string, options: { apiKey?: string; model?: string; baseUrl?: string }) => {
    const config = new ConfigService();
    const providerConfig: Record<string, string> = {};
    if (options.apiKey) providerConfig['apiKey'] = options.apiKey;
    if (options.model) providerConfig['model'] = options.model;
    if (options.baseUrl) providerConfig['baseUrl'] = options.baseUrl;
    await config.setProviderConfig(name, providerConfig);
    logger.info({ provider: name }, 'Provider configuration saved');
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'Unexpected error');
  process.exit(1);
});
