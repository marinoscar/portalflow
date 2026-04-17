import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ConfigService } from '../../config/config.service.js';

export async function runResetFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const providerCount = Object.keys(cfg.providers ?? {}).length;

  if (providerCount === 0 && !cfg.activeProvider) {
    p.log.info('Nothing to reset — no configuration exists yet.');
    return;
  }

  // Show what will be removed
  const lines: string[] = [];
  lines.push(pc.yellow('This will permanently delete:'));
  lines.push(`  • ${providerCount} configured provider${providerCount === 1 ? '' : 's'}`);
  if (cfg.activeProvider) {
    lines.push(`  • Active provider selection (${cfg.activeProvider})`);
  }
  lines.push(`  • All stored API keys and model settings`);
  lines.push('');
  lines.push(pc.dim('Location: ~/.portalflow/config.json'));
  p.note(lines.join('\n'), pc.red('Reset all configurations'));

  // Primary confirm
  const confirmFirst = await p.confirm({
    message: 'Are you sure you want to delete all configurations?',
    initialValue: false,
  });

  if (p.isCancel(confirmFirst) || !confirmFirst) {
    p.log.info('Reset cancelled. No changes made.');
    return;
  }

  // Type-to-confirm second step for safety
  const typedConfirm = await p.text({
    message: `Type ${pc.bold('reset')} to confirm:`,
    placeholder: 'reset',
    validate(value) {
      if (value.trim().toLowerCase() !== 'reset') {
        return 'You must type "reset" exactly to proceed, or press Ctrl+C to cancel';
      }
      return undefined;
    },
  });

  if (p.isCancel(typedConfirm)) {
    p.log.info('Reset cancelled. No changes made.');
    return;
  }

  // Perform the reset
  await configService.reset();
  p.log.success('All configurations have been removed. You can start fresh.');
}
