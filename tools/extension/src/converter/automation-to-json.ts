import { AutomationSchema, type Automation } from '@portalflow/schema';

export type ValidationResult =
  | { ok: true; json: string; data: Automation }
  | { ok: false; errors: string[] };

export function automationToJson(automation: Automation): ValidationResult {
  const result = AutomationSchema.safeParse(automation);
  if (!result.success) {
    const flat = result.error.flatten();
    const errors: string[] = [];
    for (const err of flat.formErrors) errors.push(err);
    for (const [field, errs] of Object.entries(flat.fieldErrors)) {
      for (const err of errs ?? []) errors.push(`${field}: ${err}`);
    }
    return { ok: false, errors };
  }
  return {
    ok: true,
    json: JSON.stringify(result.data, null, 2),
    data: result.data,
  };
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'automation'
  );
}
