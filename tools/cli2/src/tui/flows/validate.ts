import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFile } from 'node:fs/promises';
import { pickAutomationFile } from '../file-picker.js';
import { AutomationSchema } from '@portalflow/schema';

export interface ValidateFlowOptions {
  nested?: boolean;
}

export async function runValidateFlow(options: ValidateFlowOptions = {}): Promise<void> {
  if (!options.nested) {
    p.intro(pc.bgCyan(pc.black(' PortalFlow · Validate Automation ')));
  } else {
    p.log.step(pc.cyan('Validate Automation'));
  }

  const picked = await pickAutomationFile('Which automation do you want to validate?');
  if (picked.cancelled) {
    p.log.info('Validation cancelled.');
    if (!options.nested) p.outro('');
    return;
  }

  try {
    const raw = await readFile(picked.path, 'utf-8');
    const json = JSON.parse(raw);
    const result = AutomationSchema.safeParse(json);

    if (result.success) {
      const automation = result.data;
      const summaryLines = [
        `${pc.dim('ID:')}      ${automation.id}`,
        `${pc.dim('Name:')}    ${pc.cyan(automation.name)}`,
        `${pc.dim('Version:')} ${automation.version}`,
        `${pc.dim('Goal:')}    ${automation.goal}`,
        `${pc.dim('Steps:')}   ${automation.steps.length}`,
        `${pc.dim('Inputs:')}  ${automation.inputs.length}`,
      ];
      if (automation.tools && automation.tools.length > 0) {
        summaryLines.push(`${pc.dim('Tools:')}   ${automation.tools.map((t) => t.name).join(', ')}`);
      }
      p.note(summaryLines.join('\n'), pc.green('Validation Passed'));
    } else {
      const flat = result.error.flatten();
      const errorLines: string[] = [];
      if (flat.formErrors.length > 0) {
        errorLines.push(pc.red('Form errors:'));
        for (const err of flat.formErrors) errorLines.push(`  ${err}`);
      }
      for (const [field, errs] of Object.entries(flat.fieldErrors)) {
        errorLines.push(pc.red(`${field}:`));
        for (const e of errs ?? []) errorLines.push(`  ${e}`);
      }
      p.note(errorLines.join('\n') || 'Unknown validation error', pc.red('Validation Failed'));
      process.exitCode = 1;
    }
  } catch (err) {
    p.log.error(`Failed to read/parse file: ${(err as Error).message}`);
    process.exitCode = 1;
  }

  if (!options.nested) {
    p.outro('');
  }
}
