import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFile } from 'node:fs/promises';
import { pickAutomationFile } from '../file-picker.js';
import { AutomationSchema } from '@portalflow/schema';
import { ConfigService } from '../../config/config.service.js';
import { resolvePaths, resolveVideo } from '../../runner/paths.js';

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
  let automation;
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

  // 3. Resolve effective paths and video config for preview
  let effectivePaths = { screenshots: './artifacts/screenshots', videos: './artifacts/videos', downloads: './artifacts/downloads', automations: './automations' };
  let effectiveVideo = { enabled: false, width: 1280, height: 720 };
  try {
    const configService = new ConfigService();
    const userConfig = await configService.load();
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
  previewLines.push(`${pc.dim('Videos:')}      ${effectivePaths.videos} ${effectiveVideo.enabled ? pc.green('(recording)') : pc.dim('(off)')}`);
  previewLines.push(`${pc.dim('Downloads:')}   ${effectivePaths.downloads}`);
  p.note(previewLines.join('\n'), pc.green('Automation Preview'));

  // 5. Ask about headless mode
  const headlessDefault = automation.settings?.headless ?? false;
  const headless = await p.confirm({
    message: 'Run in headless mode?',
    initialValue: headlessDefault,
  });
  if (p.isCancel(headless)) {
    p.log.info('Run cancelled.');
    if (!options.nested) p.outro('');
    return;
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

  // 8. Execute — dynamic import so we don't pay playwright startup cost for non-run flows
  p.log.info(pc.dim('Launching automation... (browser output will follow)'));
  console.log(''); // visual break

  try {
    const { AutomationRunner } = await import('../../runner/automation-runner.js');
    const runner = new AutomationRunner();
    const result = await runner.run(picked.path, {
      headless: headless as boolean,
      video: videoForRun as boolean,
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
  }

  if (!options.nested) {
    p.outro(pc.dim('See ./artifacts for screenshots and downloads.'));
  }
}
