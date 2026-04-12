import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ConfigService } from '../../config/config.service.js';
import { providerDisplayName } from '../helpers.js';

export async function runSetActiveFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const providerNames = Object.keys(cfg.providers ?? {});

  if (providerNames.length < 2) {
    p.log.warn(
      providerNames.length === 0
        ? 'No providers configured. Configure at least two providers first.'
        : 'Only one provider is configured. Configure another provider first.',
    );
    return;
  }

  const current = cfg.activeProvider;

  const choice = await p.select({
    message: 'Select the active provider:',
    options: providerNames.map((name) => ({
      value: name,
      label: providerDisplayName(name),
      hint: name === current ? 'currently active' : undefined,
    })),
  });

  if (p.isCancel(choice)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const chosen = choice as string;
  await configService.setActiveProvider(chosen);

  p.note(`Active provider set to ${pc.cyan(providerDisplayName(chosen))}`, 'Updated');
}
