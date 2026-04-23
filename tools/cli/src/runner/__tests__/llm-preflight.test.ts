import { describe, it, expect, vi } from 'vitest';
import type { Automation } from '@portalflow/schema';
import { automationRequiresLlm, formatPingFailure, preflightLlm } from '../llm-preflight.js';
import type { LlmService } from '../../llm/llm.service.js';
import type { PingResult } from '../../llm/provider.interface.js';

function makeAutomation(steps: Automation['steps']): Automation {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    name: 't',
    version: '1.0.0',
    description: 't',
    goal: 't',
    inputs: [],
    steps,
    // functions / settings / tools are optional
  } as unknown as Automation;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mkStep = (type: string, action: unknown, extra: Record<string, unknown> = {}): any => ({
  id: `s-${type}`,
  name: type,
  type,
  action,
  onFailure: 'abort',
  maxRetries: 0,
  timeout: 0,
  ...extra,
});

describe('automationRequiresLlm', () => {
  it('returns false for a deterministic-only automation', () => {
    const automation = makeAutomation([
      mkStep('navigate', { url: 'https://example.com' }),
      mkStep('interact', { interaction: 'click' }),
      mkStep('wait', { condition: 'network_idle' }),
      mkStep('extract', { target: 'text', outputName: 'x' }),
    ]);
    expect(automationRequiresLlm(automation)).toBe(false);
  });

  it('returns true when any step is aiscope', () => {
    const automation = makeAutomation([
      mkStep('navigate', { url: 'https://x.test' }),
      mkStep('aiscope', {
        goal: 'go',
        maxDurationSec: 60,
        maxIterations: 5,
        includeScreenshot: false,
      }),
    ]);
    expect(automationRequiresLlm(automation)).toBe(true);
  });

  it('returns true when condition uses ai', () => {
    const automation = makeAutomation([mkStep('condition', { ai: 'Is the modal visible?' })]);
    expect(automationRequiresLlm(automation)).toBe(true);
  });

  it('returns false when condition is fully deterministic', () => {
    const automation = makeAutomation([
      mkStep('condition', { check: 'element_exists', value: 'button.foo' }),
    ]);
    expect(automationRequiresLlm(automation)).toBe(false);
  });

  it('returns true when loop discovers items via ai description', () => {
    const automation = makeAutomation([
      mkStep('loop', {
        maxIterations: 3,
        items: { description: 'each promo email row', itemVar: 'row', order: 'natural' },
      }),
    ]);
    expect(automationRequiresLlm(automation)).toBe(true);
  });

  it('recurses into substeps', () => {
    const automation = makeAutomation([
      mkStep(
        'loop',
        { maxIterations: 2 },
        {
          substeps: [
            mkStep('aiscope', {
              goal: 'nested',
              maxDurationSec: 30,
              maxIterations: 4,
              includeScreenshot: false,
            }),
          ],
        },
      ),
    ]);
    expect(automationRequiresLlm(automation)).toBe(true);
  });

  it('recurses into functions', () => {
    const a = makeAutomation([mkStep('navigate', { url: 'https://x.test' })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a as any).functions = [
      {
        name: 'helper',
        steps: [mkStep('condition', { ai: 'ok?' })],
      },
    ];
    expect(automationRequiresLlm(a)).toBe(true);
  });
});

describe('preflightLlm', () => {
  it('skips the check when the automation is deterministic', async () => {
    const automation = makeAutomation([mkStep('navigate', { url: 'https://x.test' })]);
    const llmService = {
      verifyConnectivity: vi.fn(),
    } as unknown as LlmService;

    const outcome = await preflightLlm(automation, llmService);

    expect(outcome).toEqual({ skipped: true });
    expect(llmService.verifyConnectivity).not.toHaveBeenCalled();
  });

  it('calls verifyConnectivity when the automation uses LLM', async () => {
    const automation = makeAutomation([
      mkStep('aiscope', {
        goal: 'go',
        maxDurationSec: 60,
        maxIterations: 5,
        includeScreenshot: false,
      }),
    ]);
    const pingResult: PingResult = {
      ok: true,
      providerName: 'anthropic',
      model: 'm',
      latencyMs: 123,
    };
    const llmService = {
      verifyConnectivity: vi.fn().mockResolvedValue(pingResult),
    } as unknown as LlmService;

    const outcome = await preflightLlm(automation, llmService);

    expect(outcome).toEqual({ skipped: false, result: pingResult });
    expect(llmService.verifyConnectivity).toHaveBeenCalledTimes(1);
  });
});

describe('formatPingFailure', () => {
  it('produces a multi-line block with provider, model, error, and hint', () => {
    const block = formatPingFailure({
      ok: false,
      providerName: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      status: 401,
      message: '401 Unauthorized — bad key',
      hint: 'Update your API key with: portalflow provider config anthropic --api-key <new-key>',
    });

    expect(block).toContain('✗ LLM connectivity check failed');
    expect(block).toContain('Provider:  anthropic (model: claude-sonnet-4-20250514)');
    expect(block).toContain('Error:     401 Unauthorized');
    expect(block).toContain('What to try:');
    expect(block).toContain('portalflow provider config anthropic');
  });
});
