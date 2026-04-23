/**
 * run.ts (CLI)
 *
 * Interactive run flow for portalflow. Ported from tools/cli/src/tui/flows/run.ts
 * with the BrowserService/PageService wiring replaced by ExtensionHost +
 * ChromeLauncher + AutomationRunner.
 *
 * Flow:
 *   1. Pick the automation file (file-picker)
 *   2. Validate the JSON against the schema
 *   3. Resolve effective paths + extension config
 *   4. Show automation preview
 *   5. Collect missing / overrideable inputs
 *   6. Ask about video recording
 *   7. Confirm before running
 *   8. Ensure profile mode is set (first-run prompt if needed)
 *   9. Start ExtensionHost, launch Chrome, wait for extension handshake
 *  10. Run the automation via AutomationRunner
 *  11. Show result summary
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFile } from 'node:fs/promises';
import { pickAutomationFile } from '../file-picker.js';
import { AutomationSchema } from '@portalflow/schema';
import type { Automation } from '@portalflow/schema';
import { ConfigService } from '../../config/config.service.js';
import { resolvePaths, resolveVideo } from '../../runner/paths.js';
import { asTrimmedString } from '../helpers.js';

export interface RunFlowOptions {
  nested?: boolean;
}

export async function runRunFlow(options: RunFlowOptions = {}): Promise<void> {
  if (!options.nested) {
    p.intro(pc.bgCyan(pc.black(' PortalFlow · Run Automation ')));
  } else {
    p.log.step(pc.cyan('Run Automation'));
  }

  // 1. Pick the file
  const picked = await pickAutomationFile('Which automation do you want to run?');
  if (picked.cancelled) {
    p.log.info('Run cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 2. Validate before running
  let automation: Automation;
  try {
    const raw = await readFile(picked.path, 'utf-8');
    const json = JSON.parse(raw);
    const result = AutomationSchema.safeParse(json);
    if (!result.success) {
      p.log.error(pc.red('Schema validation failed — cannot run.'));
      const flat = result.error.flatten();
      const errorLines = [
        ...(flat.formErrors.length > 0 ? [`Form errors: ${flat.formErrors.join(', ')}`] : []),
        ...Object.entries(flat.fieldErrors).map(([k, v]) => `${k}: ${(v ?? []).join(', ')}`),
      ];
      p.note(errorLines.join('\n') || 'Unknown validation error', 'Errors');
      if (!options.nested) p.outro('');
      return;
    }
    automation = result.data;
  } catch (err) {
    p.log.error(`Failed to read/parse file: ${(err as Error).message}`);
    if (!options.nested) p.outro('');
    return;
  }

  // 3. Load config and resolve effective paths
  const configService = new ConfigService();
  let effectivePaths = {
    screenshots: './artifacts/screenshots',
    videos: './artifacts/videos',
    downloads: './artifacts/downloads',
    automations: './automations',
  };
  let effectiveVideo = { enabled: false, width: 1280, height: 720 };
  let userConfig = await configService.load();

  try {
    effectivePaths = resolvePaths(userConfig, automation.settings);
    effectiveVideo = resolveVideo(userConfig, automation.settings);
  } catch {
    // Non-fatal — use defaults in preview
  }

  // 4. Show preview
  const previewLines = [
    `${pc.dim('Name:')}    ${pc.cyan(automation.name)}`,
    `${pc.dim('Goal:')}    ${automation.goal}`,
    `${pc.dim('Steps:')}   ${automation.steps.length}`,
    `${pc.dim('Inputs:')}  ${automation.inputs.length}`,
  ];
  if (automation.tools && automation.tools.length > 0) {
    previewLines.push(`${pc.dim('Tools:')}   ${automation.tools.map((t) => t.name).join(', ')}`);
  }
  if (automation.outputs && automation.outputs.length > 0) {
    previewLines.push(`${pc.dim('Outputs:')} ${automation.outputs.map((o) => o.name).join(', ')}`);
  }
  previewLines.push('');
  previewLines.push(`${pc.dim('Screenshots:')} ${effectivePaths.screenshots}`);
  previewLines.push(
    `${pc.dim('Videos:')}      ${effectivePaths.videos} ${
      effectiveVideo.enabled ? pc.green('(recording)') : pc.dim('(off)')
    }`,
  );
  previewLines.push(`${pc.dim('Downloads:')}   ${effectivePaths.downloads}`);
  p.note(previewLines.join('\n'), pc.green('Automation Preview'));

  // 5. Collect missing / overrideable inputs
  const collectedInputs = new Map<string, string>();
  const inputsToPrompt = buildInputsToPrompt(automation);

  if (inputsToPrompt.length > 0) {
    p.log.info(
      pc.dim(
        `This automation has ${inputsToPrompt.length} input(s) to configure before running.`,
      ),
    );

    for (const input of inputsToPrompt) {
      const label = input.description
        ? `${input.name} — ${input.description}`
        : input.name;

      let raw: string | boolean | symbol;

      if (input.type === 'boolean') {
        const initialValue =
          input.value === 'true' ? true : input.value === 'false' ? false : false;
        raw = await p.confirm({
          message: label,
          initialValue,
        });
      } else if (input.type === 'secret') {
        raw = await p.password({
          message: label,
          validate: input.required
            ? (v) => (asTrimmedString(v as string | undefined) === '' ? 'This input is required' : undefined)
            : undefined,
        });
      } else if (input.type === 'number') {
        raw = await p.text({
          message: label,
          initialValue: input.source === 'cli_arg' ? (input.value ?? '') : '',
          validate: (v) => {
            const s = asTrimmedString(v);
            if (input.required && s === '') return 'This input is required';
            if (s !== '' && isNaN(parseFloat(s))) return 'Must be a number';
            return undefined;
          },
        });
      } else {
        // string (default)
        raw = await p.text({
          message: label,
          initialValue: input.source === 'cli_arg' ? (input.value ?? '') : '',
          validate: input.required
            ? (v) => (asTrimmedString(v) === '' ? 'This input is required' : undefined)
            : undefined,
        });
      }

      if (p.isCancel(raw)) {
        p.log.info('Run cancelled.');
        if (!options.nested) p.outro('');
        return;
      }

      const stringValue =
        typeof raw === 'boolean' ? String(raw) : (raw as string);
      if (stringValue !== '') {
        collectedInputs.set(input.name, stringValue);
      }
    }
  }

  // 6. Ask about video recording
  const videoForRun = await p.confirm({
    message: 'Enable video recording for this run?',
    initialValue: effectiveVideo.enabled,
  });
  if (p.isCancel(videoForRun)) {
    p.log.info('Run cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 6a. Ask about killing existing Chrome instances
  const killChrome = await p.confirm({
    message: 'Close all existing Chrome instances before launching?',
    initialValue: false,
  });
  if (p.isCancel(killChrome)) {
    p.log.info('Run cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 6b. Ask about clearing browsing history/cache
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
    p.log.info('Run cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 7. Final confirmation
  const start = await p.confirm({
    message: `Start running ${pc.cyan(automation.name)}?`,
    initialValue: true,
  });
  if (p.isCancel(start) || !start) {
    p.log.info('Run cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  // 8. Ensure the user has chosen a Chrome profile mode (first-run prompt)
  const { ensureProfileChoice } = await import('./profile-prompt.js');
  let extensionConfig;
  try {
    // Reload config in case settings were changed
    userConfig = await configService.load();
    extensionConfig = await ensureProfileChoice(userConfig, configService);
  } catch (err) {
    p.log.error((err as Error).message);
    if (!options.nested) p.outro('');
    return;
  }

  // 9. Launch Chrome and wait for extension
  p.log.info(pc.dim('Starting extension host and launching Chrome...'));

  const { ExtensionHost } = await import('../../browser/extension-host.js');
  const { launchChromeAndWaitForExtension, killExistingChrome } = await import('../../browser/chrome-launcher.js');
  const pino = await import('pino');

  // Use a silent logger for the launch phase — the TUI owns stdout
  const silentLogger = pino.default({ level: 'silent' });

  // Kill existing Chrome instances if requested
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
    // Print multi-line error nicely
    for (const line of msg.split('\n')) {
      console.log(`  ${line}`);
    }
    await host.close().catch(() => undefined);
    if (!options.nested) p.outro('');
    return;
  }

  // Clear browsing data if requested (after handshake, before steps execute)
  if (clearHistory && clearHistory !== 'none') {
    try {
      await host.clearBrowsingData(clearHistory as import('../../browser/protocol.js').ClearBrowsingDataRange);
      p.log.info(`Cleared browsing data: ${clearHistory}`);
    } catch (err) {
      p.log.warn(`clearBrowsingData failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // 10. Execute via AutomationRunner (reuse the already-started host)
  p.log.info(pc.dim('Launching automation...'));
  console.log(''); // visual break

  try {
    const { AutomationRunner } = await import('../../runner/automation-runner.js');
    const runner = new AutomationRunner();
    const result = await runner.run(picked.path, {
      video: videoForRun as boolean,
      inputs: collectedInputs.size > 0 ? collectedInputs : undefined,
      extensionHost: host,
    });

    console.log(''); // visual break
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
      if (result.errors.length > 5) {
        summaryLines.push(pc.dim(`  ... and ${result.errors.length - 5} more`));
      }
    }

    p.note(summaryLines.join('\n'), result.success ? pc.green('Run Complete') : pc.red('Run Failed'));

    if (!result.success) process.exitCode = 1;
  } catch (err) {
    p.log.error(`Automation run failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    // Close the host we opened (runner was given it as caller-supplied, so
    // runner does not close it; we must close it here).
    await host.close().catch(() => undefined);
  }

  if (!options.nested) {
    p.outro(pc.dim('See ./artifacts for screenshots and downloads.'));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines which inputs need to be collected interactively.
 *
 * Rules:
 * - literal source with a non-empty value → resolvable, skip
 * - env source with the env var set      → resolvable, skip
 * - vaultcli source                       → resolvable at runtime, skip
 * - cli_arg with a default (value field)  → optional prompt (user may override)
 * - cli_arg with no default               → mandatory prompt
 */
function buildInputsToPrompt(automation: Automation): Automation['inputs'] {
  return automation.inputs.filter((input) => {
    const source = input.source ?? 'literal';
    if (source === 'literal' && input.value !== undefined && input.value !== '') {
      return false;
    }
    if (source === 'env') {
      const envKey = input.value ?? input.name;
      if (process.env[envKey] !== undefined) {
        return false;
      }
    }
    if (source === 'vaultcli') {
      return false;
    }
    return true;
  });
}
