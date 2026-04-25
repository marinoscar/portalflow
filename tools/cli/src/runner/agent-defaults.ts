import type { AgentDefaultsConfig, CliConfig } from '../config/config.service.js';

/**
 * Built-in defaults for `portalflow agent "<goal>"` (goal-driven mode).
 * These are tuned for top-level goals — 2× the iteration cap and 3× the
 * wall-clock cap of the aiscope sub-step defaults (which assume an
 * automation has done most of the work already).
 *
 * Tweaking these requires a discussion: changing them shifts what users
 * see when they run `portalflow agent` without a config file. Keep them
 * conservative enough that a curious first-run user doesn't burn many
 * dollars on tokens before realising what's happening.
 */
export const BUILT_IN_AGENT_DEFAULTS = {
  mode: 'agent',
  maxIterations: 50,
  maxDuration: 900,
  maxReplans: 2,
  includeScreenshot: true,
  startUrl: undefined,
} as const;

export interface EffectiveAgentDefaults {
  mode: 'fast' | 'agent';
  maxIterations: number;
  maxDuration: number;
  maxReplans: number;
  includeScreenshot: boolean;
  startUrl: string | undefined;
}

/** A subset of EffectiveAgentDefaults the CLI can pass to override the
 *  config layer. `null` clears a field (forces it back to the built-in
 *  default — useful for `--no-start-url` semantics). */
export type AgentOverrides = Partial<{
  [K in keyof EffectiveAgentDefaults]: EffectiveAgentDefaults[K] | null;
}>;

/**
 * Resolve effective agent defaults using precedence:
 * CLI override > user config > built-in default.
 *
 * Mirrors the shape of `resolvePaths` and `resolveVideo`. Pure function;
 * call once per `portalflow agent` invocation and pass the result down.
 */
export function resolveAgentDefaults(
  userConfig: CliConfig,
  cliOverrides?: AgentOverrides,
): EffectiveAgentDefaults {
  const fromConfig: AgentDefaultsConfig = userConfig.agent ?? {};
  const ov = cliOverrides ?? {};

  const pick = <K extends keyof EffectiveAgentDefaults>(
    key: K,
  ): EffectiveAgentDefaults[K] => {
    const cli = ov[key];
    if (cli === null) {
      // Explicit null = clear back to built-in default.
      return BUILT_IN_AGENT_DEFAULTS[key] as EffectiveAgentDefaults[K];
    }
    if (cli !== undefined) return cli as EffectiveAgentDefaults[K];
    const cfg = fromConfig[key];
    if (cfg !== undefined) return cfg as EffectiveAgentDefaults[K];
    return BUILT_IN_AGENT_DEFAULTS[key] as EffectiveAgentDefaults[K];
  };

  return {
    mode: pick('mode'),
    maxIterations: pick('maxIterations'),
    maxDuration: pick('maxDuration'),
    maxReplans: pick('maxReplans'),
    includeScreenshot: pick('includeScreenshot'),
    startUrl: pick('startUrl'),
  };
}
