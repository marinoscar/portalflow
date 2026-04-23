import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ConfigService } from '../../config/config.service.js';
import { providerDisplayName } from '../helpers.js';

export async function runRemoveFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const providers = cfg.providers ?? {};
  const providerNames = Object.keys(providers);

  if (providerNames.length === 0) {
    p.log.warn('No providers configured. Nothing to remove.');
    return;
  }

  const choice = await p.select({
    message: 'Which provider do you want to remove?',
    options: providerNames.map((name) => ({
      value: name,
      label: providerDisplayName(name),
      hint: name === cfg.activeProvider ? 'currently active' : undefined,
    })),
  });

  if (p.isCancel(choice)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const chosen = choice as string;

  const confirmed = await p.confirm({
    message: `Remove ${pc.bold(providerDisplayName(chosen))}? This will delete the stored API key.`,
    initialValue: false,
  });

  if (p.isCancel(confirmed)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  if (!confirmed) {
    p.log.info('No changes made.');
    return;
  }

  // Delete the provider from config
  const freshCfg = await configService.load();
  if (freshCfg.providers) {
    delete freshCfg.providers[chosen];
  }
  if (freshCfg.activeProvider === chosen) {
    delete freshCfg.activeProvider;
  }
  await configService.save(freshCfg);

  p.note(`${pc.cyan(providerDisplayName(chosen))} has been removed.`, 'Removed');
}
