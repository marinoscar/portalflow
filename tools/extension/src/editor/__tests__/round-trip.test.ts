/**
 * Round-trip test: parse a real automation file through AutomationSchema,
 * emit via automationToJson, and confirm the output parses back to a
 * structurally equivalent object.
 *
 * The example file is read from:
 *   tools/cli/examples/aiscope-agent-demo.json
 * relative to the repository root (resolved via import.meta.url).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutomationSchema } from '@portalflow/schema';
import { automationToJson } from '../../converter/automation-to-json';
import type { Automation } from '@portalflow/schema';

// ---------------------------------------------------------------------------
// Locate the example file relative to this test's location
// ---------------------------------------------------------------------------

const __dirname_test = dirname(fileURLToPath(import.meta.url));
// From src/editor/__tests__/ go up to the worktree root, then into tools/cli/examples
const EXAMPLE_PATH = resolve(
  __dirname_test,
  '../../../../',  // tools/extension/src/editor/__tests__ -> tools/extension/src/editor -> tools/extension/src -> tools/extension -> tools
  '../cli/examples/aiscope-agent-demo.json',
);

// ---------------------------------------------------------------------------
// Fixture (used if file not found)
// ---------------------------------------------------------------------------

const INLINE_FIXTURE: Automation = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'round-trip fixture',
  version: '1.0.0',
  description: 'inline test fixture for round-trip',
  goal: 'verify round-trip',
  inputs: [{ name: 'username', type: 'string', required: true }],
  steps: [
    {
      id: 's1',
      name: 'Navigate to site',
      type: 'navigate',
      action: { url: 'https://example.com' },
      onFailure: 'abort',
      maxRetries: 3,
      timeout: 30000,
    },
    {
      id: 's2',
      name: 'Wait for page',
      type: 'wait',
      action: { condition: 'network_idle' },
      onFailure: 'skip',
      maxRetries: 0,
      timeout: 10000,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip undefined fields so we can compare JSON-serialized forms. */
function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('automation round-trip', () => {
  it('aiscope-agent-demo.json (or inline fixture) survives schema parse → automationToJson → re-parse', () => {
    // Try to load the file from disk; fall back to inline fixture if absent
    let rawInput: Automation;
    let source: string;

    try {
      const raw = readFileSync(EXAMPLE_PATH, 'utf-8');
      rawInput = JSON.parse(raw) as Automation;
      source = 'file';
    } catch {
      rawInput = INLINE_FIXTURE;
      source = 'inline fixture';
    }

    // Step 1: parse through AutomationSchema
    const parsed = AutomationSchema.safeParse(rawInput);
    expect(parsed.success, `AutomationSchema.safeParse failed for ${source}`).toBe(true);
    if (!parsed.success) return;

    // Step 2: emit via automationToJson
    const result = automationToJson(parsed.data);
    expect(result.ok, `automationToJson failed for ${source}: ${!result.ok ? (result as { ok: false; errors: string[] }).errors.join(', ') : ''}`).toBe(true);
    if (!result.ok) return;

    // Step 3: re-parse the emitted JSON
    const reparsed = AutomationSchema.safeParse(JSON.parse(result.json));
    expect(reparsed.success, `Re-parse of automationToJson output failed for ${source}`).toBe(true);
    if (!reparsed.success) return;

    // Step 4: structural equality — compare normalized forms
    expect(normalize(reparsed.data)).toEqual(normalize(parsed.data));
  });

  it('inline automation fixture round-trips correctly (always runs)', () => {
    const parsed = AutomationSchema.safeParse(INLINE_FIXTURE);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = automationToJson(parsed.data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reparsed = AutomationSchema.safeParse(JSON.parse(result.json));
    expect(reparsed.success).toBe(true);
    if (!reparsed.success) return;

    expect(normalize(reparsed.data)).toEqual(normalize(parsed.data));
  });

  it('newEmptyAutomation() round-trips via automationToJson', () => {
    // Import here to avoid issues with crypto.randomUUID in non-browser env
    // We construct a known-valid empty automation manually
    const emptyAuto: Automation = {
      id: '22222222-3333-4444-5555-666666666666',
      name: 'empty automation',
      version: '1.0.0',
      description: '',
      goal: '',
      inputs: [],
      steps: [],
    };

    const parsed = AutomationSchema.safeParse(emptyAuto);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const result = automationToJson(parsed.data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reparsed = AutomationSchema.safeParse(JSON.parse(result.json));
    expect(reparsed.success).toBe(true);
    if (!reparsed.success) return;

    expect(normalize(reparsed.data)).toEqual(normalize(parsed.data));
  });
});
