import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ConfigService } from '../../config/config.service.js';
import {
  resolveAgentDefaults,
  BUILT_IN_AGENT_DEFAULTS,
  type EffectiveAgentDefaults,
} from '../../runner/agent-defaults.js';
import { asTrimmedString } from '../helpers.js';

/**
 * Edit the persisted defaults for `portalflow agent "<goal>"`. Same shape
 * as the settings-paths flow: print current values, let the user pick
 * which field to change (or "all"), prompt for each, persist via
 * ConfigService.setAgentDefaults.
 */
export async function runSettingsAgentFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const current = resolveAgentDefaults(cfg);

  p.note(
    [
      `Mode:               ${current.mode}`,
      `Max iterations:     ${current.maxIterations}`,
      `Max duration:       ${current.maxDuration}s`,
      `Max replans:        ${current.maxReplans}`,
      `Include screenshot: ${current.includeScreenshot ? 'yes' : 'no'}`,
      `Start URL:          ${current.startUrl ?? pc.dim('(none — LLM decides)')}`,
    ].join('\n'),
    'Current agent defaults',
  );

  const choice = await p.select<keyof EffectiveAgentDefaults | 'all' | 'cancel'>({
    message: 'Which default would you like to change?',
    options: [
      { value: 'mode' as const, label: 'Mode (fast / agent)', hint: current.mode },
      { value: 'maxIterations' as const, label: 'Max iterations (1-200)', hint: String(current.maxIterations) },
      { value: 'maxDuration' as const, label: 'Max duration (seconds, 1-3600)', hint: `${current.maxDuration}s` },
      { value: 'maxReplans' as const, label: 'Max replans (0-10)', hint: String(current.maxReplans) },
      { value: 'includeScreenshot' as const, label: 'Include per-iteration screenshot', hint: current.includeScreenshot ? 'yes' : 'no' },
      { value: 'startUrl' as const, label: 'Start URL (blank = LLM decides)', hint: current.startUrl ?? '(none)' },
      { value: 'all' as const, label: 'Edit every field in sequence' },
      { value: 'cancel' as const, label: 'Back to settings menu' },
    ],
  });

  if (p.isCancel(choice) || choice === 'cancel') return;

  const keys: (keyof EffectiveAgentDefaults)[] =
    choice === 'all'
      ? ['mode', 'maxIterations', 'maxDuration', 'maxReplans', 'includeScreenshot', 'startUrl']
      : [choice];

  const update: Partial<{ [K in keyof EffectiveAgentDefaults]: EffectiveAgentDefaults[K] | null }> = {};

  for (const key of keys) {
    const result = await promptForField(key, current);
    if (p.isCancel(result)) return;
    if (result !== undefined) {
      // result === null means "clear" (e.g., empty start URL).
      (update as Record<string, unknown>)[key] = result;
    }
  }

  await configService.setAgentDefaults(update);
  p.log.success('Agent defaults updated');
}

async function promptForField<K extends keyof EffectiveAgentDefaults>(
  key: K,
  current: EffectiveAgentDefaults,
): Promise<EffectiveAgentDefaults[K] | null | symbol | undefined> {
  switch (key) {
    case 'mode': {
      const value = await p.select<'fast' | 'agent'>({
        message: 'Mode:',
        initialValue: current.mode,
        options: [
          { value: 'agent' as const, label: 'agent', hint: 'planner + milestones (default)' },
          { value: 'fast' as const, label: 'fast', hint: 'one LLM call per iteration' },
        ],
      });
      return value as EffectiveAgentDefaults[K] | symbol;
    }
    case 'maxIterations':
      return promptInt(`Max iterations (1-200):`, current.maxIterations, 1, 200) as Promise<EffectiveAgentDefaults[K] | symbol>;
    case 'maxDuration':
      return promptInt(`Max duration in seconds (1-3600):`, current.maxDuration, 1, 3600) as Promise<EffectiveAgentDefaults[K] | symbol>;
    case 'maxReplans':
      return promptInt(`Max replans (0-10):`, current.maxReplans, 0, 10) as Promise<EffectiveAgentDefaults[K] | symbol>;
    case 'includeScreenshot': {
      const value = await p.confirm({
        message: 'Include per-iteration viewport screenshot?',
        initialValue: current.includeScreenshot,
      });
      return value as EffectiveAgentDefaults[K] | symbol;
    }
    case 'startUrl': {
      const value = await p.text({
        message: 'Start URL (blank = LLM decides):',
        initialValue: current.startUrl ?? '',
        placeholder: 'https://example.com',
      });
      if (p.isCancel(value)) return value;
      const trimmed = asTrimmedString(value);
      // Empty input → null (clears the field) so the next run falls back
      // to the built-in default ("LLM decides where to go").
      return (trimmed.length === 0 ? null : trimmed) as EffectiveAgentDefaults[K] | null;
    }
  }
  return undefined;
}

async function promptInt(
  message: string,
  initial: number,
  min: number,
  max: number,
): Promise<number | symbol> {
  const value = await p.text({
    message,
    initialValue: String(initial),
    placeholder: String(BUILT_IN_AGENT_DEFAULTS.maxIterations),
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n)) return 'Enter an integer';
      if (n < min || n > max) return `Must be between ${min} and ${max}`;
      return undefined;
    },
  });
  if (p.isCancel(value)) return value;
  return Number(asTrimmedString(value));
}
