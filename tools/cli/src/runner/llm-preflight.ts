import type {
  Automation,
  ConditionAction,
  LoopAction,
  Step,
} from '@portalflow/schema';
import type { LlmService } from '../llm/llm.service.js';
import type { PingResult } from '../llm/provider.interface.js';

/**
 * Recursively walk every step (and every step inside every function body)
 * looking for an LLM-requiring construct. Returns `true` as soon as one is
 * found so we don't waste cycles scanning the whole tree when we already
 * know the answer.
 *
 * LLM-requiring steps:
 *   - type === 'aiscope'          — always invokes decideNextAction (and
 *                                   decidePlan in agent mode)
 *   - type === 'condition' + ai   — invokes evaluateCondition
 *   - type === 'loop' + items.description
 *                                 — invokes findItems for AI item discovery
 *   - type === 'loop' + exitWhen.ai
 *                                 — invokes evaluateCondition each iteration
 *   - any step with substeps      — recurse
 *
 * NOT counted: the fallback `findElement` path inside ElementResolver. That
 * only fires when a primary selector fails at runtime — it's opportunistic,
 * not required. Pre-flighting every automation "because it might trip the
 * fallback" would force a network round-trip on every deterministic run.
 */
export function automationRequiresLlm(automation: Automation): boolean {
  if (stepsRequireLlm(automation.steps)) return true;
  for (const fn of automation.functions ?? []) {
    if (stepsRequireLlm(fn.steps)) return true;
  }
  return false;
}

function stepsRequireLlm(steps: Step[]): boolean {
  return steps.some(stepRequiresLlm);
}

function stepRequiresLlm(step: Step): boolean {
  if (step.type === 'aiscope') return true;

  if (step.type === 'condition') {
    const action = step.action as ConditionAction;
    if (typeof action.ai === 'string' && action.ai.trim().length > 0) return true;
  }

  if (step.type === 'loop') {
    const action = step.action as LoopAction;
    if (action.items?.description) return true;
    const exitWhen = action.exitWhen as { ai?: string } | undefined;
    if (exitWhen?.ai && exitWhen.ai.trim().length > 0) return true;
  }

  if (step.substeps && stepsRequireLlm(step.substeps)) return true;

  return false;
}

/**
 * Format a failing `PingResult` into a user-facing multi-line block. Shape:
 *
 *   ✗ LLM connectivity check failed
 *
 *   Provider:  anthropic (model: claude-sonnet-4-20250514)
 *   Error:     401 Unauthorized — the anthropic API rejected ...
 *
 *   What to try:
 *     → Update your API key with: portalflow provider config anthropic --api-key <new-key>
 *
 *   This automation uses LLM-powered steps (aiscope / condition.ai /
 *   loop.items.description) so the run cannot continue. Fix the issue
 *   above, or switch providers with: portalflow provider set <name>
 */
export function formatPingFailure(result: Extract<PingResult, { ok: false }>): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('✗ LLM connectivity check failed');
  lines.push('');
  lines.push(`  Provider:  ${result.providerName} (model: ${result.model})`);
  lines.push(`  Error:     ${result.message}`);
  lines.push('');
  lines.push('  What to try:');
  lines.push(`    → ${result.hint}`);
  lines.push('');
  lines.push(
    '  This automation uses LLM-powered steps (aiscope / condition.ai /',
  );
  lines.push(
    '  loop.items.description) so the run cannot continue. Fix the issue',
  );
  lines.push(
    '  above, or switch providers with: portalflow provider set <name>',
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * Run the pre-flight check if (and only if) the automation requires LLM.
 * Returns the ping result so the caller can decide whether to surface it
 * in the TUI or abort. For pure-deterministic automations the check is
 * skipped entirely — no network round-trip, no slowdown.
 */
export async function preflightLlm(
  automation: Automation,
  llmService: LlmService,
): Promise<{ skipped: true } | { skipped: false; result: PingResult }> {
  if (!automationRequiresLlm(automation)) {
    return { skipped: true };
  }
  const result = await llmService.verifyConnectivity();
  return { skipped: false, result };
}
