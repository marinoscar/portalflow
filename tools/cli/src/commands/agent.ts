import { randomUUID } from 'node:crypto';
import { AutomationSchema, type Automation } from '@portalflow/schema';
import type { EffectiveAgentDefaults } from '../runner/agent-defaults.js';

export interface SynthesizeAgentOpts {
  /** The user's goal. Required; non-empty. */
  goal: string;
  /** Resolved defaults (CLI > config > built-in). The synthesizer is
   *  pure — it does not read config; the caller resolves first. */
  defaults: EffectiveAgentDefaults;
  /** Names of `--input KEY=VAL` / `--inputs-json` keys the user passed.
   *  Each becomes a declared `cli_arg` input on the synthesized
   *  automation so the runner's input-resolution loop will pull values
   *  out of `RunOptions.inputs` and expose them as context variables
   *  (the LLM gets `availableInputs` populated with the names). */
  inputKeys?: readonly string[];
}

/**
 * Build an in-memory `Automation` object from a goal + resolved defaults.
 * Goes through `AutomationSchema.safeParse` so every field default
 * declared in the schema (`onFailure: 'abort'`, `maxRetries: 3`,
 * `timeout: 30000`, etc.) gets applied automatically — the synthesizer
 * only needs to spell out the fields it actually cares about.
 *
 * Throws on schema-validation failure with a structured error. That
 * shouldn't happen in normal operation; if it does it's a bug in this
 * file or a schema-shape regression.
 */
export function synthesizeAgentAutomation(opts: SynthesizeAgentOpts): Automation {
  const { goal, defaults, inputKeys = [] } = opts;
  if (!goal || goal.trim().length === 0) {
    throw new Error('synthesizeAgentAutomation: goal is required and must be non-empty');
  }

  const id = randomUUID();

  // Step ids are namespaced under `agent-` so they cannot clash with
  // ids in any user-authored automation that happens to coexist in the
  // run logger context.
  const steps: unknown[] = [];

  if (defaults.startUrl) {
    steps.push({
      id: 'agent-navigate',
      name: `Navigate to ${defaults.startUrl}`,
      type: 'navigate',
      action: { url: defaults.startUrl },
      validation: { type: 'url_contains', value: extractDomain(defaults.startUrl) },
      onFailure: 'abort',
      maxRetries: 2,
      timeout: 15000,
    });
  }

  steps.push({
    id: 'agent-goal',
    name: truncateForName(goal),
    description: goal,
    type: 'aiscope',
    action: {
      goal,
      mode: defaults.mode,
      maxIterations: defaults.maxIterations,
      maxDurationSec: defaults.maxDuration,
      maxReplans: defaults.maxReplans,
      includeScreenshot: defaults.includeScreenshot,
    },
    onFailure: 'abort',
    maxRetries: 0,
    // Step timeout = aiscope's wall-clock budget plus a 60s grace so the
    // outer step-level timer never fires before the aiscope's own
    // budget logic does. The aiscope step type is exempt from the
    // step-timeout race in step-executor.ts (composite types are), but
    // we set a sensible value anyway for log/telemetry consistency.
    timeout: defaults.maxDuration * 1000 + 60_000,
  });

  const input = {
    id,
    name: `agent: ${truncateForName(goal)}`,
    version: '1.0.0',
    description: 'Goal-driven run synthesized by `portalflow agent`.',
    goal,
    inputs: inputKeys.map((name) => ({
      name,
      type: 'string' as const,
      required: true,
      source: 'cli_arg' as const,
    })),
    steps,
  };

  const parsed = AutomationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      'Internal error: synthesized agent automation failed schema validation:\n' +
        JSON.stringify(parsed.error.flatten(), null, 2),
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function truncateForName(s: string, max = 60): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // If the user's start URL doesn't parse, skip the validation by
    // returning a substring guaranteed to match (the URL itself).
    // The runner will surface the navigation failure if the URL is
    // truly malformed.
    return url;
  }
}
