import { AutomationSchema } from '@portalflow/schema';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Body of `portalflow schema [--pretty]`. Converts the AutomationSchema
 * Zod definition to a JSON Schema document and writes it to stdout.
 *
 * Agents shelling out to portalflow can run this once at startup to learn
 * the exact field set the runner expects, then synthesize automation JSON
 * without referring to docs/AUTOMATION-JSON-SPEC.md. The output is a
 * single self-contained JSON Schema (draft-07 compatible), so jq, ajv,
 * or any standard tool can consume it directly.
 *
 * Returns nothing; exits the process via stdout write only (no exit call).
 */
export function runSchemaCommand(opts: { pretty?: boolean }): void {
  const schema = zodToJsonSchema(AutomationSchema, {
    name: 'Automation',
    $refStrategy: 'root',
  });
  const text = opts.pretty
    ? JSON.stringify(schema, null, 2)
    : JSON.stringify(schema);
  process.stdout.write(text + '\n');
}
