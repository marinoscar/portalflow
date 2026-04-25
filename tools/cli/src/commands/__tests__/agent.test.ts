/**
 * Unit tests for synthesizeAgentAutomation().
 *
 * The function is pure — it reads no config and makes no I/O calls.
 * All tests exercise the returned Automation shape and the AutomationSchema
 * round-trip to confirm the synthesizer never produces a shape the runner
 * would reject.
 */

import { describe, it, expect } from 'vitest';
import { AutomationSchema } from '@portalflow/schema';
import { synthesizeAgentAutomation } from '../agent.js';
import { BUILT_IN_AGENT_DEFAULTS } from '../../runner/agent-defaults.js';
import type { EffectiveAgentDefaults } from '../../runner/agent-defaults.js';

// ---------------------------------------------------------------------------
// Re-usable fixture: the resolved defaults as they would arrive in practice
// (mirrors BUILT_IN_AGENT_DEFAULTS exactly — callers can override per-test).
// ---------------------------------------------------------------------------

const builtInDefaults: EffectiveAgentDefaults = {
  mode: 'agent',
  maxIterations: 50,
  maxDuration: 900,
  maxReplans: 2,
  includeScreenshot: true,
  startUrl: undefined,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Build a merged EffectiveAgentDefaults for a single test without mutating
 *  the shared fixture. */
function defaults(overrides: Partial<EffectiveAgentDefaults> = {}): EffectiveAgentDefaults {
  return { ...builtInDefaults, ...overrides };
}

// ---------------------------------------------------------------------------
// A. Goal-only (no startUrl) — single aiscope step
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — goal only, no startUrl', () => {
  const automation = synthesizeAgentAutomation({
    goal: 'open example.com',
    defaults: defaults(),
  });

  it('returns exactly 1 step', () => {
    expect(automation.steps).toHaveLength(1);
  });

  it('the only step has type "aiscope"', () => {
    expect(automation.steps[0]!.type).toBe('aiscope');
  });

  it('the aiscope step id is "agent-goal"', () => {
    expect(automation.steps[0]!.id).toBe('agent-goal');
  });

  it('aiscope step action.goal matches the supplied goal', () => {
    const action = automation.steps[0]!.action as { goal: string };
    expect(action.goal).toBe('open example.com');
  });

  it('aiscope action.mode matches defaults', () => {
    const action = automation.steps[0]!.action as { mode: string };
    expect(action.mode).toBe(builtInDefaults.mode);
  });

  it('aiscope action.maxIterations matches defaults', () => {
    const action = automation.steps[0]!.action as { maxIterations: number };
    expect(action.maxIterations).toBe(builtInDefaults.maxIterations);
  });

  it('aiscope action.maxDurationSec matches defaults.maxDuration', () => {
    const action = automation.steps[0]!.action as { maxDurationSec: number };
    expect(action.maxDurationSec).toBe(builtInDefaults.maxDuration);
  });

  it('automation.id is a UUID (RFC 4122 format)', () => {
    expect(automation.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('automation.inputs is an empty array when no inputKeys are provided', () => {
    expect(automation.inputs).toEqual([]);
  });

  it('automation.version is "1.0.0"', () => {
    expect(automation.version).toBe('1.0.0');
  });

  it('automation.description is a non-empty string', () => {
    expect(typeof automation.description).toBe('string');
    expect(automation.description.length).toBeGreaterThan(0);
  });

  it('automation.goal matches the supplied goal', () => {
    expect(automation.goal).toBe('open example.com');
  });
});

// ---------------------------------------------------------------------------
// B. With startUrl → navigate step prepended
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — with startUrl', () => {
  const automation = synthesizeAgentAutomation({
    goal: 'search for shoes',
    defaults: defaults({ startUrl: 'https://example.com' }),
  });

  it('returns exactly 2 steps', () => {
    expect(automation.steps).toHaveLength(2);
  });

  it('first step id is "agent-navigate"', () => {
    expect(automation.steps[0]!.id).toBe('agent-navigate');
  });

  it('first step type is "navigate"', () => {
    expect(automation.steps[0]!.type).toBe('navigate');
  });

  it('navigate step action.url matches startUrl', () => {
    const action = automation.steps[0]!.action as { url: string };
    expect(action.url).toBe('https://example.com');
  });

  it('navigate step validation type is "url_contains"', () => {
    expect(automation.steps[0]!.validation?.type).toBe('url_contains');
  });

  it('navigate step validation value is the hostname', () => {
    expect(automation.steps[0]!.validation?.value).toBe('example.com');
  });

  it('second step type is "aiscope"', () => {
    expect(automation.steps[1]!.type).toBe('aiscope');
  });

  it('second step id is "agent-goal"', () => {
    expect(automation.steps[1]!.id).toBe('agent-goal');
  });
});

// ---------------------------------------------------------------------------
// C. startUrl with subpath and query string — validation uses hostname only
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — startUrl with subpath/query', () => {
  const automation = synthesizeAgentAutomation({
    goal: 'find a product',
    defaults: defaults({ startUrl: 'https://shop.example.com/products?id=42' }),
  });

  it('navigate step validation value is the hostname (shop.example.com)', () => {
    expect(automation.steps[0]!.validation?.value).toBe('shop.example.com');
  });

  it('navigate step action.url is the full startUrl, not just the hostname', () => {
    const action = automation.steps[0]!.action as { url: string };
    expect(action.url).toBe('https://shop.example.com/products?id=42');
  });
});

// ---------------------------------------------------------------------------
// D. startUrl that fails URL parse — falls back to raw string
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — startUrl that fails URL parse', () => {
  const badUrl = 'not-a-url';

  it('does not throw', () => {
    expect(() =>
      synthesizeAgentAutomation({
        goal: 'do something',
        defaults: defaults({ startUrl: badUrl }),
      }),
    ).not.toThrow();
  });

  it('navigate step validation value falls back to the raw startUrl string', () => {
    const automation = synthesizeAgentAutomation({
      goal: 'do something',
      defaults: defaults({ startUrl: badUrl }),
    });
    expect(automation.steps[0]!.validation?.value).toBe(badUrl);
  });
});

// ---------------------------------------------------------------------------
// E. With inputKeys
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — with inputKeys', () => {
  const automation = synthesizeAgentAutomation({
    goal: 'log in as a specific user',
    defaults: defaults(),
    inputKeys: ['username', 'password'],
  });

  it('automation.inputs has exactly 2 entries', () => {
    expect(automation.inputs).toHaveLength(2);
  });

  it('first input name is "username"', () => {
    expect(automation.inputs[0]!.name).toBe('username');
  });

  it('second input name is "password"', () => {
    expect(automation.inputs[1]!.name).toBe('password');
  });

  it('both inputs have type "string"', () => {
    for (const input of automation.inputs) {
      expect(input.type).toBe('string');
    }
  });

  it('both inputs have required: true', () => {
    for (const input of automation.inputs) {
      expect(input.required).toBe(true);
    }
  });

  it('both inputs have source: "cli_arg"', () => {
    for (const input of automation.inputs) {
      expect(input.source).toBe('cli_arg');
    }
  });
});

// ---------------------------------------------------------------------------
// F. Empty / whitespace goal throws
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — invalid goal throws', () => {
  it('throws on empty string', () => {
    expect(() =>
      synthesizeAgentAutomation({ goal: '', defaults: defaults() }),
    ).toThrow(/goal/i);
  });

  it('throws on whitespace-only goal', () => {
    expect(() =>
      synthesizeAgentAutomation({ goal: '   ', defaults: defaults() }),
    ).toThrow(/goal/i);
  });
});

// ---------------------------------------------------------------------------
// G. Non-default defaults flow through to aiscope action
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — non-default defaults flow through', () => {
  const nonDefaults: EffectiveAgentDefaults = {
    mode: 'fast',
    maxIterations: 75,
    maxDuration: 600,
    maxReplans: 1,
    includeScreenshot: false,
    startUrl: undefined,
  };

  const automation = synthesizeAgentAutomation({
    goal: 'do a thing',
    defaults: nonDefaults,
  });

  const action = automation.steps[0]!.action as {
    mode: string;
    maxIterations: number;
    maxDurationSec: number;
    maxReplans: number;
    includeScreenshot: boolean;
  };

  it('aiscope action.mode reflects non-default value "fast"', () => {
    expect(action.mode).toBe('fast');
  });

  it('aiscope action.maxIterations reflects non-default value 75', () => {
    expect(action.maxIterations).toBe(75);
  });

  it('aiscope action.maxDurationSec reflects non-default value 600', () => {
    expect(action.maxDurationSec).toBe(600);
  });

  it('aiscope action.maxReplans reflects non-default value 1', () => {
    expect(action.maxReplans).toBe(1);
  });

  it('aiscope action.includeScreenshot reflects non-default value false', () => {
    expect(action.includeScreenshot).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H. AutomationSchema round-trip — synthesizer output is always schema-valid
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — AutomationSchema.safeParse succeeds', () => {
  it('goal-only automation parses successfully', () => {
    const automation = synthesizeAgentAutomation({
      goal: 'verify the homepage loads',
      defaults: defaults(),
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('automation with startUrl parses successfully', () => {
    const automation = synthesizeAgentAutomation({
      goal: 'check the login form',
      defaults: defaults({ startUrl: 'https://example.com/login' }),
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('automation with inputKeys parses successfully', () => {
    const automation = synthesizeAgentAutomation({
      goal: 'submit a form',
      defaults: defaults(),
      inputKeys: ['email', 'token'],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('automation with non-default budgets parses successfully', () => {
    const automation = synthesizeAgentAutomation({
      goal: 'long running task',
      defaults: defaults({ mode: 'fast', maxIterations: 75, maxDuration: 600, maxReplans: 1, includeScreenshot: false }),
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// I. Long goal → name is truncated with ellipsis
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — long goal name truncation', () => {
  const longGoal = 'a'.repeat(200);

  const automation = synthesizeAgentAutomation({
    goal: longGoal,
    defaults: defaults(),
  });

  it('automation name ends with "…" when goal exceeds 60 chars', () => {
    expect(automation.name).toMatch(/…$/);
  });

  it('automation name length is bounded (≤ 66 chars including "agent: " prefix)', () => {
    // "agent: " (7) + 60-char body (59 chars + "…") = 7 + 60 = 67 max
    expect(automation.name.length).toBeLessThanOrEqual(67);
  });

  it('aiscope step name ends with "…"', () => {
    const aiScopeStep = automation.steps.find((s) => s.type === 'aiscope');
    expect(aiScopeStep!.name).toMatch(/…$/);
  });

  it('aiscope step name length is bounded (≤ 60 chars)', () => {
    const aiScopeStep = automation.steps.find((s) => s.type === 'aiscope');
    expect(aiScopeStep!.name.length).toBeLessThanOrEqual(60);
  });

  it('schema round-trip still succeeds for an automation with a long goal', () => {
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// J. Each call produces a fresh UUID (no caching / singleton id)
// ---------------------------------------------------------------------------

describe('synthesizeAgentAutomation — each call produces a unique id', () => {
  it('two consecutive calls return different UUIDs', () => {
    const a = synthesizeAgentAutomation({ goal: 'task one', defaults: defaults() });
    const b = synthesizeAgentAutomation({ goal: 'task one', defaults: defaults() });
    expect(a.id).not.toBe(b.id);
  });
});
