import { createRequire } from 'node:module';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ConfigService } from '../config/config.service.js';
import { providerDisplayName } from './helpers.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

type MainAction = 'run' | 'agent' | 'validate' | 'provider' | 'settings' | 'exit';

export async function runMainTui(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(` PortalFlow v${version} `)));

  // Initial status
  const config = new ConfigService();
  try {
    const cfg = await config.load();
    const active = cfg.activeProvider;
    if (!active) {
      p.log.warn('No active LLM provider. Configure one via "Manage LLM providers" before running automations.');
    } else {
      const model = cfg.providers?.[active]?.model;
      p.log.info(`Active provider: ${pc.cyan(providerDisplayName(active))}${model ? ` (${model})` : ''}`);
    }
  } catch {
    // Config read failure is not fatal — continue
  }

  while (true) {
    const action = await p.select<MainAction>({
      message: 'What would you like to do?',
      options: [
        { value: 'run' as MainAction, label: 'Run an automation', hint: 'execute a JSON workflow in a browser' },
        { value: 'agent' as MainAction, label: 'Run from goal', hint: 'describe what you want; the agent figures it out' },
        { value: 'validate' as MainAction, label: 'Validate an automation', hint: 'check JSON against the schema' },
        { value: 'provider' as MainAction, label: 'Manage LLM providers', hint: 'Anthropic, OpenAI, Kimi, DeepSeek, Groq, etc.' },
        { value: 'settings' as MainAction, label: 'Settings', hint: 'storage paths, video recording' },
        { value: 'exit' as MainAction, label: 'Exit' },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel('Cancelled');
      process.exit(0);
    }

    switch (action) {
      case 'run': {
        const { runRunFlow } = await import('./flows/run.js');
        await runRunFlow({ nested: true });
        break;
      }
      case 'agent': {
        const { runAgentFlow } = await import('./flows/agent.js');
        await runAgentFlow({ nested: true });
        break;
      }
      case 'validate': {
        const { runValidateFlow } = await import('./flows/validate.js');
        await runValidateFlow({ nested: true });
        break;
      }
      case 'provider': {
        const { runProviderTui } = await import('./provider-tui.js');
        await runProviderTui({ nested: true });
        break;
      }
      case 'settings': {
        const { runSettingsTui } = await import('./settings-tui.js');
        await runSettingsTui({ nested: true });
        break;
      }
      case 'exit':
        p.outro(pc.dim('See you next time.'));
        return;
    }
  }
}
