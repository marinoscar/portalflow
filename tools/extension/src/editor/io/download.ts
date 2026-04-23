import type { Automation } from '@portalflow/schema';
import { automationToJson, slugify } from '../../converter/automation-to-json';

// ---------------------------------------------------------------------------
// downloadAutomation
// ---------------------------------------------------------------------------

export async function downloadAutomation(
  automation: Automation,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const result = automationToJson(automation);

  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  const blob = new Blob([result.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url,
    filename: `${slugify(automation.name)}.json`,
    saveAs: true,
  });

  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return { ok: true };
}
