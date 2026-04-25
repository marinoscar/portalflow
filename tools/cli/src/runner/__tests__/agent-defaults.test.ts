/**
 * Unit tests for resolveAgentDefaults() — pure precedence logic.
 *
 * Precedence (highest to lowest):
 *   CLI override  > user config  > built-in default
 *
 * `null` in the CLI override layer explicitly clears the field and forces
 * it back to the built-in default.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_AGENT_DEFAULTS,
  resolveAgentDefaults,
} from '../agent-defaults.js';
import type { CliConfig } from '../../config/config.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An empty CliConfig — represents a user who has never run `portalflow configure`. */
const emptyConfig: CliConfig = {};

// ---------------------------------------------------------------------------
// Empty config + no overrides → pure built-in defaults
// ---------------------------------------------------------------------------

describe('resolveAgentDefaults — empty config, no CLI overrides', () => {
  it('mode falls back to built-in "agent"', () => {
    const result = resolveAgentDefaults(emptyConfig);
    expect(result.mode).toBe(BUILT_IN_AGENT_DEFAULTS.mode);
  });

  it('maxIterations falls back to built-in 50', () => {
    const result = resolveAgentDefaults(emptyConfig);
    expect(result.maxIterations).toBe(BUILT_IN_AGENT_DEFAULTS.maxIterations);
  });

  it('maxDuration falls back to built-in 900', () => {
    const result = resolveAgentDefaults(emptyConfig);
    expect(result.maxDuration).toBe(BUILT_IN_AGENT_DEFAULTS.maxDuration);
  });

  it('maxReplans falls back to built-in 2', () => {
    const result = resolveAgentDefaults(emptyConfig);
    expect(result.maxReplans).toBe(BUILT_IN_AGENT_DEFAULTS.maxReplans);
  });

  it('includeScreenshot falls back to built-in true', () => {
    const result = resolveAgentDefaults(emptyConfig);
    expect(result.includeScreenshot).toBe(BUILT_IN_AGENT_DEFAULTS.includeScreenshot);
  });

  it('startUrl falls back to built-in undefined', () => {
    const result = resolveAgentDefaults(emptyConfig);
    expect(result.startUrl).toBeUndefined();
  });

  it('result shape contains all six keys', () => {
    const result = resolveAgentDefaults(emptyConfig);
    expect(Object.keys(result).sort()).toEqual(
      ['includeScreenshot', 'maxDuration', 'maxIterations', 'maxReplans', 'mode', 'startUrl'],
    );
  });
});

// ---------------------------------------------------------------------------
// Config layer wins over built-in when no CLI override is present
// ---------------------------------------------------------------------------

describe('resolveAgentDefaults — config layer overrides built-in', () => {
  it('config mode "fast" is reflected in the result', () => {
    const result = resolveAgentDefaults({ agent: { mode: 'fast' } });
    expect(result.mode).toBe('fast');
  });

  it('config maxIterations 100 is reflected in the result', () => {
    const result = resolveAgentDefaults({ agent: { maxIterations: 100 } });
    expect(result.maxIterations).toBe(100);
  });

  it('fields not set in config still fall back to built-in values', () => {
    const result = resolveAgentDefaults({ agent: { mode: 'fast', maxIterations: 100 } });
    // These two come from config.
    expect(result.mode).toBe('fast');
    expect(result.maxIterations).toBe(100);
    // The rest must fall to built-in.
    expect(result.maxDuration).toBe(BUILT_IN_AGENT_DEFAULTS.maxDuration);
    expect(result.maxReplans).toBe(BUILT_IN_AGENT_DEFAULTS.maxReplans);
    expect(result.includeScreenshot).toBe(BUILT_IN_AGENT_DEFAULTS.includeScreenshot);
    expect(result.startUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CLI override wins over config
// ---------------------------------------------------------------------------

describe('resolveAgentDefaults — CLI override wins over config', () => {
  it('CLI mode "agent" wins when config says "fast"', () => {
    const result = resolveAgentDefaults(
      { agent: { mode: 'fast' } },
      { mode: 'agent' },
    );
    expect(result.mode).toBe('agent');
  });

  it('CLI maxIterations wins when config also sets maxIterations', () => {
    const result = resolveAgentDefaults(
      { agent: { maxIterations: 20 } },
      { maxIterations: 75 },
    );
    expect(result.maxIterations).toBe(75);
  });

  it('CLI startUrl wins when config also sets startUrl', () => {
    const result = resolveAgentDefaults(
      { agent: { startUrl: 'https://config.example.com' } },
      { startUrl: 'https://cli.example.com' },
    );
    expect(result.startUrl).toBe('https://cli.example.com');
  });
});

// ---------------------------------------------------------------------------
// CLI null clears back to built-in (explicit clear semantics)
// ---------------------------------------------------------------------------

describe('resolveAgentDefaults — CLI null clears to built-in', () => {
  it('null startUrl in CLI overrides config value → resolves to undefined', () => {
    const result = resolveAgentDefaults(
      { agent: { startUrl: 'https://x.com' } },
      { startUrl: null },
    );
    expect(result.startUrl).toBeUndefined();
  });

  it('null maxIterations in CLI overrides config value → resolves to built-in 50', () => {
    const result = resolveAgentDefaults(
      { agent: { maxIterations: 200 } },
      { maxIterations: null },
    );
    expect(result.maxIterations).toBe(50);
  });

  it('null mode in CLI overrides config "fast" → resolves to built-in "agent"', () => {
    const result = resolveAgentDefaults(
      { agent: { mode: 'fast' } },
      { mode: null },
    );
    expect(result.mode).toBe('agent');
  });

  it('null includeScreenshot → resolves to built-in true', () => {
    const result = resolveAgentDefaults(
      { agent: { includeScreenshot: false } },
      { includeScreenshot: null },
    );
    expect(result.includeScreenshot).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full three-layer precedence chain
// ---------------------------------------------------------------------------

describe('resolveAgentDefaults — full three-layer precedence', () => {
  it('CLI wins for specified fields, config wins for unspecified-CLI fields, built-in fills the rest', () => {
    // Config sets all six fields to non-default values.
    const config: CliConfig = {
      agent: {
        mode: 'fast',
        maxIterations: 80,
        maxDuration: 600,
        maxReplans: 5,
        includeScreenshot: false,
        startUrl: 'https://config.example.com',
      },
    };
    // CLI overrides only two fields.
    const cliOverrides = {
      maxIterations: 25,
      startUrl: 'https://cli.example.com',
    };

    const result = resolveAgentDefaults(config, cliOverrides);

    // CLI wins for the two specified fields.
    expect(result.maxIterations).toBe(25);
    expect(result.startUrl).toBe('https://cli.example.com');

    // Config wins for the four fields not mentioned in CLI overrides.
    expect(result.mode).toBe('fast');
    expect(result.maxDuration).toBe(600);
    expect(result.maxReplans).toBe(5);
    expect(result.includeScreenshot).toBe(false);
  });
});
