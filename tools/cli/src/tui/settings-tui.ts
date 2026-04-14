import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ConfigService } from '../config/config.service.js';
import { resolvePaths, resolveVideo } from '../runner/paths.js';
import { runSettingsPathsFlow } from './flows/settings-paths.js';
import { runSettingsVideoFlow } from './flows/settings-video.js';
import { runSettingsLoggingFlow } from './flows/settings-logging.js';

type SettingsAction = 'view' | 'paths' | 'video' | 'logging' | 'reset' | 'exit';

export interface SettingsTuiOptions {
  nested?: boolean;
}

export async function runSettingsTui(options: SettingsTuiOptions = {}): Promise<void> {
  const configService = new ConfigService();

  if (!options.nested) {
    p.intro(pc.bgCyan(pc.black(' PortalFlow · Settings ')));
  } else {
    p.log.step(pc.cyan('Settings'));
  }

  while (true) {
    const action = await p.select<SettingsAction>({
      message: 'What would you like to configure?',
      options: [
        {
          value: 'view' as SettingsAction,
          label: 'View current settings',
          hint: 'show paths and video config',
        },
        {
          value: 'paths' as SettingsAction,
          label: 'Configure storage paths',
          hint: 'automations, screenshots, videos, downloads',
        },
        {
          value: 'video' as SettingsAction,
          label: 'Configure video recording',
          hint: 'enable/disable, resolution',
        },
        {
          value: 'logging' as SettingsAction,
          label: 'Configure logging',
          hint: 'level, file output, pretty print, secret redaction',
        },
        {
          value: 'reset' as SettingsAction,
          label: 'Reset to defaults',
          hint: pc.yellow('removes paths, video, and logging from config'),
        },
        {
          value: 'exit' as SettingsAction,
          label: options.nested ? 'Back' : 'Exit',
        },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel('Cancelled');
      process.exit(0);
    }

    switch (action) {
      case 'view': {
        const cfg = await configService.load();
        const paths = resolvePaths(cfg);
        const video = resolveVideo(cfg);
        const logging = cfg.logging ?? {};
        p.note(
          [
            pc.dim('Storage paths:'),
            `  Automations:  ${paths.automations}`,
            `  Screenshots:  ${paths.screenshots}`,
            `  Videos:       ${paths.videos}`,
            `  Downloads:    ${paths.downloads}`,
            '',
            pc.dim('Video recording:'),
            `  Enabled: ${video.enabled ? pc.green('yes') : pc.dim('no')}`,
            `  Width:   ${video.width}`,
            `  Height:  ${video.height}`,
            '',
            pc.dim('Logging:'),
            `  Level:          ${logging.level ?? 'info (default)'}`,
            `  File:           ${logging.file ?? pc.dim('(none — stdout only)')}`,
            `  Pretty:         ${logging.pretty ?? true ? 'yes' : 'no'}`,
            `  Redact secrets: ${logging.redactSecrets ?? true ? 'yes' : 'no'}`,
          ].join('\n'),
          'Current Settings',
        );
        break;
      }

      case 'paths':
        await runSettingsPathsFlow(configService);
        break;

      case 'video':
        await runSettingsVideoFlow(configService);
        break;

      case 'logging':
        await runSettingsLoggingFlow(configService);
        break;

      case 'reset': {
        const confirm = await p.confirm({
          message: 'Remove paths, video, and logging sections from config (reset to built-in defaults)?',
          initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) {
          p.log.info('Reset cancelled.');
          break;
        }
        const cfg = await configService.load();
        delete cfg.paths;
        delete cfg.video;
        delete cfg.logging;
        await configService.save(cfg);
        p.log.success('Paths, video, and logging settings reset to built-in defaults');
        break;
      }

      case 'exit':
        if (!options.nested) {
          p.outro(pc.dim('Run portalflow settings --help for non-interactive configuration.'));
        } else {
          p.log.info(pc.dim('Returning to main menu...'));
        }
        return;
    }
  }
}
