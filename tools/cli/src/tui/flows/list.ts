import pc from 'picocolors';
import type { ConfigService } from '../../config/config.service.js';
import { providerDisplayName } from '../helpers.js';
import * as p from '@clack/prompts';

export async function runListFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const providers = cfg.providers ?? {};
  const providerNames = Object.keys(providers);

  if (providerNames.length === 0) {
    p.log.info('No providers configured yet.');
    return;
  }

  const active = cfg.activeProvider;
  const lines: string[] = [];

  for (const name of providerNames) {
    const prov = providers[name];
    const displayName = providerDisplayName(name);
    const model = prov?.model ?? pc.dim('(no model)');
    const activeMarker = name === active ? pc.green(' [active]') : '';

    lines.push(`${pc.bold(displayName)}${activeMarker}`);
    lines.push(`  model: ${pc.cyan(model)}`);
    if (prov?.baseUrl) {
      lines.push(`  url  : ${pc.dim(prov.baseUrl)}`);
    }
  }

  p.note(lines.join('\n'), `Configured providers (${providerNames.length})`);
}
