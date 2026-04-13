import * as p from '@clack/prompts';
import { ConfigService, type VideoConfig } from '../../config/config.service.js';
import { resolveVideo } from '../../runner/paths.js';

export async function runSettingsVideoFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const current = resolveVideo(cfg);

  p.note(
    [
      `Enabled: ${current.enabled ? 'yes' : 'no'}`,
      `Width:   ${current.width}`,
      `Height:  ${current.height}`,
    ].join('\n'),
    'Current video config',
  );

  const enable = await p.confirm({
    message: 'Enable video recording for all runs by default?',
    initialValue: current.enabled,
  });
  if (p.isCancel(enable)) return;

  const update: Partial<VideoConfig> = { enabled: enable as boolean };

  if (enable) {
    const preset = await p.select({
      message: 'Video resolution:',
      options: [
        { value: '720p', label: '720p (1280x720)', hint: 'default, smallest file size' },
        { value: '1080p', label: '1080p (1920x1080)', hint: 'HD quality' },
        { value: 'current', label: `Current (${current.width}x${current.height})`, hint: 'keep as-is' },
        { value: 'custom', label: 'Custom dimensions' },
      ],
    });
    if (p.isCancel(preset)) return;

    if (preset === '720p') {
      update.width = 1280;
      update.height = 720;
    } else if (preset === '1080p') {
      update.width = 1920;
      update.height = 1080;
    } else if (preset === 'custom') {
      const w = await p.text({
        message: 'Width (pixels):',
        initialValue: String(current.width),
        validate: (v) => (isNaN(parseInt(v, 10)) ? 'Must be a number' : undefined),
      });
      if (p.isCancel(w)) return;

      const h = await p.text({
        message: 'Height (pixels):',
        initialValue: String(current.height),
        validate: (v) => (isNaN(parseInt(v, 10)) ? 'Must be a number' : undefined),
      });
      if (p.isCancel(h)) return;

      update.width = parseInt(w as string, 10);
      update.height = parseInt(h as string, 10);
    }
    // 'current' preset: no dimension changes needed
  }

  await configService.setVideo(update);
  p.log.success('Video config updated');
}
