import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ConfigService, type LoggingConfig, type LogLevel } from '../../config/config.service.js';

const LEVELS: Array<{ value: LogLevel; label: string; hint: string }> = [
  { value: 'trace', label: 'trace', hint: 'everything — very verbose' },
  { value: 'debug', label: 'debug', hint: 'full troubleshooting detail (recommended)' },
  { value: 'info', label: 'info', hint: 'normal operation (default)' },
  { value: 'warn', label: 'warn', hint: 'warnings and errors only' },
  { value: 'error', label: 'error', hint: 'errors only' },
  { value: 'fatal', label: 'fatal', hint: 'fatal-level failures only' },
  { value: 'silent', label: 'silent', hint: 'suppress all logs' },
];

export async function runSettingsLoggingFlow(configService: ConfigService): Promise<void> {
  const current = await configService.getLogging();

  p.note(
    [
      `Level:           ${current.level ?? 'info (default)'}`,
      `Log file:        ${current.file ?? pc.dim('(none — stdout only)')}`,
      `Pretty output:   ${current.pretty ?? true ? 'yes (default)' : 'no'}`,
      `Redact secrets:  ${current.redactSecrets ?? true ? 'yes (default)' : 'no'}`,
    ].join('\n'),
    'Current logging config',
  );

  const level = await p.select<LogLevel>({
    message: 'Minimum log level:',
    initialValue: (current.level ?? 'info') as LogLevel,
    options: LEVELS.map((l) => ({
      value: l.value,
      label: l.label,
      hint: l.hint,
    })),
  });
  if (p.isCancel(level)) return;

  const useFile = await p.confirm({
    message: 'Also write logs to a file?',
    initialValue: !!current.file,
  });
  if (p.isCancel(useFile)) return;

  let file: string | undefined = current.file;
  if (useFile) {
    const filePrompt = await p.text({
      message: 'Log file path:',
      initialValue: current.file ?? '~/.portalflow/portalflow.log',
      placeholder: '~/.portalflow/portalflow.log',
    });
    if (p.isCancel(filePrompt)) return;
    const raw = filePrompt.trim();
    file = raw.startsWith('~')
      ? raw.replace(/^~/, process.env['HOME'] ?? '~')
      : raw;
  } else {
    file = undefined;
  }

  const pretty = await p.confirm({
    message: 'Pretty-print stdout logs (colorized, human-readable)?',
    initialValue: current.pretty ?? true,
  });
  if (p.isCancel(pretty)) return;

  const redact = await p.confirm({
    message: 'Redact values in secret inputs and known-sensitive fields (apiKey, password, otp, token)?',
    initialValue: current.redactSecrets ?? true,
  });
  if (p.isCancel(redact)) return;

  const update: LoggingConfig = {
    level: level as LogLevel,
    file,
    pretty: pretty as boolean,
    redactSecrets: redact as boolean,
  };

  await configService.setLogging(update);
  p.log.success('Logging config updated');
  p.log.info(
    pc.dim(
      'CLI flag `--log-level` and env var LOG_LEVEL both override this config when set.',
    ),
  );
}
