import * as p from '@clack/prompts';
import { ConfigService, type PathsConfig } from '../../config/config.service.js';
import { resolvePaths, DEFAULT_PATHS, type EffectivePaths } from '../../runner/paths.js';

export async function runSettingsPathsFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const current = resolvePaths(cfg);

  p.note(
    [
      `Automations:  ${current.automations}`,
      `Screenshots:  ${current.screenshots}`,
      `Videos:       ${current.videos}`,
      `Downloads:    ${current.downloads}`,
    ].join('\n'),
    'Current paths',
  );

  const choice = await p.select({
    message: 'Which path would you like to change?',
    options: [
      { value: 'automations', label: 'Automations directory', hint: current.automations },
      { value: 'screenshots', label: 'Screenshots directory', hint: current.screenshots },
      { value: 'videos', label: 'Videos directory', hint: current.videos },
      { value: 'downloads', label: 'Downloads directory', hint: current.downloads },
      { value: 'all', label: 'Edit all four in sequence' },
      { value: 'cancel', label: 'Back to settings menu' },
    ],
  });

  if (p.isCancel(choice) || choice === 'cancel') return;

  const keys: (keyof EffectivePaths)[] =
    choice === 'all'
      ? ['automations', 'screenshots', 'videos', 'downloads']
      : [choice as keyof EffectivePaths];

  const update: Partial<PathsConfig> = {};
  for (const key of keys) {
    const input = await p.text({
      message: `${key} directory:`,
      initialValue: current[key],
      placeholder: DEFAULT_PATHS[key],
    });
    if (p.isCancel(input)) return;
    update[key] = (input as string).trim();
  }

  await configService.setPaths(update);
  p.log.success('Paths updated');
}
