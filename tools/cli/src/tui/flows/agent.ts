/**
 * agent.ts (CLI TUI flow)
 *
 * Goal-driven equivalent of run.ts: instead of picking a file, the user
 * types a goal in plain English and the synthesized one-step aiscope
 * automation runs through the same AutomationRunner pipeline.
 *
 * Flow:
 *   1. Goal input (multi-line text)
 *   2. Show resolved agent defaults; offer "Customize for this run" toggle
 *   3. If customize: prompt mode, start URL, max iterations, max duration
 *   4. Ask about video / kill-chrome / clear-history (same as run flow)
 *   5. Confirm
 *   6. Ensure profile mode set (first-run prompt if needed)
 *   7. Start ExtensionHost, launch Chrome, wait for extension handshake
 *   8. Synthesize automation, run via AutomationRunner.runFromAutomation
 *   9. Show result summary
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { ConfigService } from '../../config/config.service.js';
import {
  resolveAgentDefaults,
  type EffectiveAgentDefaults,
  type AgentOverrides,
} from '../../runner/agent-defaults.js';
import { asTrimmedString } from '../helpers.js';

export interface AgentFlowOptions {
  nested?: boolean;
}

export async function runAgentFlow(options: AgentFlowOptions = {}): Promise<void> {
  if (!options.nested) {
    p.intro(pc.bgCyan(pc.black(' PortalFlow · Run from Goal ')));
  } else {
    p.log.step(pc.cyan('Run from Goal'));
  }

  const configService = new ConfigService();
  let userConfig = await configService.load();

  // 1. Goal
  const goal = await p.text({
    message: 'What should the agent do?',
    placeholder: 'e.g. "Open example.com and report the page title"',
    validate: (v) => (asTrimmedString(v) === '' ? 'Goal is required' : undefined),
  });
  if (p.isCancel(goal)) {
    p.log.info('Cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 2. Resolve defaults and offer customization
  let effective = resolveAgentDefaults(userConfig);
  showDefaults(effective);

  const customize = await p.confirm({
    message: 'Customize budgets / start URL for this run?',
    initialValue: false,
  });
  if (p.isCancel(customize)) {
    p.log.info('Cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 3. Customize per-run (overrides applied on top of resolved defaults)
  const overrides: AgentOverrides = {};
  if (customize) {
    const collected = await collectOverrides(effective);
    if (collected === null) {
      p.log.info('Cancelled.');
      if (!options.nested) p.outro('');
      return;
    }
    Object.assign(overrides, collected);
    effective = resolveAgentDefaults(userConfig, overrides);
    showDefaults(effective, 'Effective values for this run');
  }

  // 4. Operational toggles (mirror run.ts)
  const videoForRun = await p.confirm({
    message: 'Enable video recording for this run?',
    initialValue: false,
  });
  if (p.isCancel(videoForRun)) {
    p.log.info('Cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  const killChrome = await p.confirm({
    message: 'Close all existing Chrome instances before launching?',
    initialValue: false,
  });
  if (p.isCancel(killChrome)) {
    p.log.info('Cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  const clearHistory = await p.select({
    message: 'Clear browsing history and cache before running?',
    options: [
      { value: 'none', label: 'None — keep browsing data as is' },
      { value: 'last15min', label: 'Last 15 minutes' },
      { value: 'last1hour', label: 'Last hour' },
      { value: 'last24hour', label: 'Last 24 hours' },
      { value: 'last7days', label: 'Last 7 days' },
      { value: 'all', label: 'All — clear everything' },
    ],
  });
  if (p.isCancel(clearHistory)) {
    p.log.info('Cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 5. Final confirmation
  const start = await p.confirm({
    message: `Start the agent on this goal?`,
    initialValue: true,
  });
  if (p.isCancel(start) || !start) {
    p.log.info('Cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 6. Profile-mode preflight (same as run flow)
  const { ensureProfileChoice } = await import('./profile-prompt.js');
  let extensionConfig;
  try {
    userConfig = await configService.load();
    extensionConfig = await ensureProfileChoice(userConfig, configService);
  } catch (err) {
    p.log.error((err as Error).message);
    if (!options.nested) p.outro('');
    return;
  }

  // 7. Launch Chrome
  p.log.info(pc.dim('Starting extension host and launching Chrome...'));

  const { ExtensionHost } = await import('../../browser/extension-host.js');
  const { launchChromeAndWaitForExtension, killExistingChrome } = await import(
    '../../browser/chrome-launcher.js'
  );
  const pino = await import('pino');
  const silentLogger = pino.default({ level: 'silent' });

  if (killChrome) {
    p.log.step('Closing existing Chrome instances...');
    await killExistingChrome(silentLogger);
  }

  let host;
  try {
    host = await ExtensionHost.start({
      host: extensionConfig.host,
      port: extensionConfig.port,
      logger: silentLogger,
    });
  } catch (err) {
    p.log.error(`Failed to start extension host: ${(err as Error).message}`);
    if (!options.nested) p.outro('');
    return;
  }

  try {
    await launchChromeAndWaitForExtension(host, extensionConfig, silentLogger);
    p.log.success('Chrome launched and extension connected.');
  } catch (err) {
    const msg = (err as Error).message;
    p.log.error(pc.red('Chrome / extension handshake failed:'));
    for (const line of msg.split('\n')) {
      console.log(`  ${line}`);
    }
    await host.close().catch(() => undefined);
    if (!options.nested) p.outro('');
    return;
  }

  if (clearHistory && clearHistory !== 'none') {
    try {
      await host.clearBrowsingData(
        clearHistory as import('../../browser/protocol.js').ClearBrowsingDataRange,
      );
      p.log.info(`Cleared browsing data: ${clearHistory}`);
    } catch (err) {
      p.log.warn(`clearBrowsingData failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // 8. Synthesize + run
  p.log.info(pc.dim('Launching agent...'));
  console.log('');

  try {
    const { synthesizeAgentAutomation } = await import('../../commands/agent.js');
    const { AutomationRunner } = await import('../../runner/automation-runner.js');
    const automation = synthesizeAgentAutomation({
      goal: asTrimmedString(goal),
      defaults: effective,
    });
    const runner = new AutomationRunner();
    const result = await runner.runFromAutomation(automation, {
      video: videoForRun as boolean,
      extensionHost: host,
    });

    console.log('');
    const durationMs = result.completedAt.getTime() - result.startedAt.getTime();
    const seconds = (durationMs / 1000).toFixed(1);
    const summaryLines = [
      `${pc.dim('Status:')}    ${result.success ? pc.green('SUCCESS') : pc.red('FAILED')}`,
      `${pc.dim('Steps:')}     ${result.stepsCompleted}/${result.stepsTotal}`,
      `${pc.dim('Duration:')}  ${seconds}s`,
      `${pc.dim('Artifacts:')} ${result.artifacts.length}`,
    ];
    if (result.errors.length > 0) {
      summaryLines.push('');
      summaryLines.push(pc.red('Errors:'));
      for (const e of result.errors.slice(0, 5)) {
        summaryLines.push(`  ${pc.dim('•')} ${e.stepName}: ${e.message}`);
      }
    }
    p.note(summaryLines.join('\n'), result.success ? pc.green('Result') : pc.red('Result'));
  } catch (err) {
    p.log.error(`Agent run failed: ${(err as Error).message}`);
  } finally {
    await host.close().catch(() => undefined);
  }

  if (!options.nested) p.outro('');
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function showDefaults(d: EffectiveAgentDefaults, title = 'Agent defaults (CLI > config > built-in)'): void {
  p.note(
    [
      `Mode:               ${d.mode}`,
      `Max iterations:     ${d.maxIterations}`,
      `Max duration:       ${d.maxDuration}s`,
      `Max replans:        ${d.maxReplans}`,
      `Include screenshot: ${d.includeScreenshot ? 'yes' : 'no'}`,
      `Start URL:          ${d.startUrl ?? pc.dim('(none — LLM decides)')}`,
    ].join('\n'),
    title,
  );
}

/**
 * Walk every per-run override prompt. Returns null if the user cancels;
 * a (possibly partial) AgentOverrides object otherwise. Empty start URL
 * input → null (clears the field for this run, falling back to built-in).
 */
async function collectOverrides(current: EffectiveAgentDefaults): Promise<AgentOverrides | null> {
  const mode = await p.select<'fast' | 'agent'>({
    message: 'Mode for this run:',
    initialValue: current.mode,
    options: [
      { value: 'agent' as const, label: 'agent', hint: 'planner + milestones' },
      { value: 'fast' as const, label: 'fast', hint: 'one LLM call per iteration' },
    ],
  });
  if (p.isCancel(mode)) return null;

  const startUrl = await p.text({
    message: 'Start URL (blank = LLM decides):',
    initialValue: current.startUrl ?? '',
    placeholder: 'https://example.com',
  });
  if (p.isCancel(startUrl)) return null;

  const maxIter = await p.text({
    message: 'Max iterations (1-200):',
    initialValue: String(current.maxIterations),
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n)) return 'Enter an integer';
      if (n < 1 || n > 200) return 'Must be 1-200';
      return undefined;
    },
  });
  if (p.isCancel(maxIter)) return null;

  const maxDur = await p.text({
    message: 'Max duration in seconds (1-3600):',
    initialValue: String(current.maxDuration),
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n)) return 'Enter an integer';
      if (n < 1 || n > 3600) return 'Must be 1-3600';
      return undefined;
    },
  });
  if (p.isCancel(maxDur)) return null;

  const screenshot = await p.confirm({
    message: 'Include per-iteration viewport screenshot?',
    initialValue: current.includeScreenshot,
  });
  if (p.isCancel(screenshot)) return null;

  const trimmedUrl = asTrimmedString(startUrl);
  return {
    mode,
    startUrl: trimmedUrl.length === 0 ? null : trimmedUrl,
    maxIterations: Number(asTrimmedString(maxIter)),
    maxDuration: Number(asTrimmedString(maxDur)),
    includeScreenshot: screenshot,
  };
}
