import { AutomationSchema } from '@portalflow/schema';
import type { Automation } from '@portalflow/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadResult =
  | { ok: true; data: Automation }
  | { ok: false; stage: 'json' | 'schema'; errors: string[]; raw?: unknown };

// ---------------------------------------------------------------------------
// readAutomationFile
// ---------------------------------------------------------------------------

export async function readAutomationFile(file: File): Promise<UploadResult> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      stage: 'json',
      errors: [`JSON parse error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const result = AutomationSchema.safeParse(parsed);
  if (!result.success) {
    const errors: string[] = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') + ': ' : '';
      return `${path}${issue.message}`;
    });
    return {
      ok: false,
      stage: 'schema',
      errors,
      raw: parsed,
    };
  }

  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// attachFileDrop — drag-and-drop handler for an element
// ---------------------------------------------------------------------------

export function attachFileDrop(
  element: HTMLElement,
  onFile: (file: File) => void,
): () => void {
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.add('drag-over');
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drag-over');
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    element.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.name.endsWith('.json') && file.type !== 'application/json') return;
    onFile(file);
  };

  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('dragenter', handleDragEnter);
  element.addEventListener('dragleave', handleDragLeave);
  element.addEventListener('drop', handleDrop);

  return () => {
    element.removeEventListener('dragover', handleDragOver);
    element.removeEventListener('dragenter', handleDragEnter);
    element.removeEventListener('dragleave', handleDragLeave);
    element.removeEventListener('drop', handleDrop);
  };
}
