import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ConfigService } from '../config/config.service.js';
import { providerDisplayName } from './helpers.js';
import { runConfigureFlow } from './flows/configure.js';
import { runSetActiveFlow } from './flows/set-active.js';
import { runListFlow } from './flows/list.js';
import { runRemoveFlow } from './flows/remove.js';
import { runResetFlow } from './flows/reset.js';

type MenuAction = 'configure' | 'set-active' | 'list' | 'remove' | 'reset' | 'exit';

export interface ProviderTuiOptions {
  nested?: boolean;
}

export async function runProviderTui(options: ProviderTuiOptions = {}): Promise<void> {
  const configService = new ConfigService();

  if (!options.nested) {
    p.intro(pc.bgCyan(pc.black(' PortalFlow · Provider Setup ')));
  } else {
    p.log.step(pc.cyan('Provider Setup'));
  }

  // Initial status display
  const cfg = await configService.load();
  const providerNames = Object.keys(cfg.providers ?? {});

  if (providerNames.length === 0) {
    p.log.info('No providers configured yet. Let\'s set one up.');
  } else {
    const active = cfg.activeProvider;
    const activeModel = active && cfg.providers?.[active]?.model;
    const activeDisplay = active
      ? `${providerDisplayName(active)}${activeModel ? ` (${activeModel})` : ''}`
      : '(none)';
    p.log.info(
      `Active: ${pc.cyan(activeDisplay)} — ${providerNames.length} provider${providerNames.length === 1 ? '' : 's'} configured`,
    );
  }

  // Main menu loop
  while (true) {
    const freshCfg = await configService.load();
    const freshProviders = Object.keys(freshCfg.providers ?? {});
    const hasNone = freshProviders.length === 0;
    const hasOne = freshProviders.length === 1;

    const action = await p.select<MenuAction>({
      message: 'What would you like to do?',
      options: [
        {
          value: 'configure' as MenuAction,
          label: 'Configure a provider',
          hint: 'add or update credentials',
        },
        {
          value: 'set-active' as MenuAction,
          label: 'Set active provider',
          hint:
            hasNone || hasOne
              ? 'configure at least 2 providers first'
              : `currently: ${freshCfg.activeProvider ? providerDisplayName(freshCfg.activeProvider) : 'none'}`,
        },
        {
          value: 'list' as MenuAction,
          label: 'List providers',
          hint: `${freshProviders.length} configured`,
        },
        {
          value: 'remove' as MenuAction,
          label: 'Remove a provider',
          hint: hasNone ? 'none configured' : undefined,
        },
        {
          value: 'reset' as MenuAction,
          label: 'Reset all configurations',
          hint: hasNone ? 'nothing to reset' : pc.yellow('deletes everything'),
        },
        {
          value: 'exit' as MenuAction,
          label: 'Exit',
        },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel('Cancelled');
      process.exit(0);
    }

    switch (action) {
      case 'configure':
        await runConfigureFlow(configService);
        break;

      case 'set-active':
        if (hasNone || hasOne) {
          p.log.warn(
            hasNone
              ? 'No providers configured. Configure at least two providers first.'
              : 'Only one provider is configured. Configure another provider first.',
          );
        } else {
          await runSetActiveFlow(configService);
        }
        break;

      case 'list':
        await runListFlow(configService);
        break;

      case 'remove':
        await runRemoveFlow(configService);
        break;

      case 'reset':
        if (hasNone && !freshCfg.activeProvider) {
          p.log.info('Nothing to reset — no configuration exists yet.');
        } else {
          await runResetFlow(configService);
        }
        break;

      case 'exit':
        if (!options.nested) {
          p.outro(
            `Run ${pc.cyan('portalflow provider config <name>')} for non-interactive configuration.`,
          );
        } else {
          p.log.info(pc.dim('Returning to main menu...'));
        }
        return;
    }
  }
}
