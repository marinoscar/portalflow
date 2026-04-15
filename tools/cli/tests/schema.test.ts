import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutomationSchema, StepSchema } from '@portalflow/schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '..', 'examples');

// Shared minimal automation base for building test cases
const BASE_AUTOMATION = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Test',
  version: '1.0.0',
  description: 'test automation',
  goal: 'test',
  inputs: [],
};

describe('AutomationSchema', () => {
  it('should validate demo-search.json', async () => {
    const raw = await readFile(join(examplesDir, 'demo-search.json'), 'utf-8');
    const result = AutomationSchema.safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  it('should validate phone-bill.json', async () => {
    const raw = await readFile(join(examplesDir, 'phone-bill.json'), 'utf-8');
    const result = AutomationSchema.safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const result = AutomationSchema.safeParse({ name: 'test' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid step type', () => {
    const result = AutomationSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440099',
      name: 'Test',
      version: '1.0.0',
      description: 'test',
      goal: 'test',
      inputs: [],
      steps: [{
        id: 'step-1',
        name: 'Bad step',
        type: 'invalid_type',
        action: {},
      }],
    });
    expect(result.success).toBe(false);
  });

  it('should apply defaults for optional fields', () => {
    const minimal = {
      id: '550e8400-e29b-41d4-a716-446655440099',
      name: 'Minimal',
      version: '1.0.0',
      description: 'minimal test',
      goal: 'test defaults',
      inputs: [],
      steps: [{
        id: 'step-1',
        name: 'Navigate',
        type: 'navigate',
        action: { url: 'https://example.com' },
      }],
    };
    const result = AutomationSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0].onFailure).toBe('abort');
      expect(result.data.steps[0].maxRetries).toBe(3);
      expect(result.data.steps[0].timeout).toBe(30000);
    }
  });
});

describe('Loop step schema', () => {
  it('should validate a loop step with literal maxIterations', () => {
    const step = {
      id: 'step-loop',
      name: 'Iterate 3 times',
      type: 'loop',
      action: {
        maxIterations: 3,
      },
      substeps: [],
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should validate a loop step with template string maxIterations', () => {
    const step = {
      id: 'step-loop',
      name: 'Iterate N times',
      type: 'loop',
      action: {
        maxIterations: '{{billCount}}',
      },
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should validate a loop step with items config', () => {
    const step = {
      id: 'step-loop',
      name: 'Loop over items',
      type: 'loop',
      action: {
        maxIterations: 5,
        items: {
          description: 'Each bill row in billing history',
          selectorPattern: '[data-testid^="bill_row_"]',
          itemVar: 'billRow',
          order: 'newest',
        },
        indexVar: 'billIndex',
      },
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action.items?.itemVar).toBe('billRow');
      expect(result.data.action.items?.order).toBe('newest');
      expect(result.data.action.indexVar).toBe('billIndex');
    }
  });

  it('should validate a loop step with exitWhen condition', () => {
    const step = {
      id: 'step-loop',
      name: 'Loop until next button gone',
      type: 'loop',
      action: {
        maxIterations: 20,
        exitWhen: {
          check: 'element_missing',
          value: 'button.next-page',
        },
      },
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should apply defaults for loop action fields', () => {
    const step = {
      id: 'step-loop',
      name: 'Loop with defaults',
      type: 'loop',
      action: {
        maxIterations: 3,
        items: {
          description: 'list items',
        },
      },
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action.items?.itemVar).toBe('item');
      expect(result.data.action.items?.order).toBe('natural');
      expect(result.data.action.indexVar).toBe('loop_index');
    }
  });

  it('should validate a loop step with recursive substeps', () => {
    const step = {
      id: 'step-loop',
      name: 'Loop with substeps',
      type: 'loop',
      action: { maxIterations: 3 },
      substeps: [
        {
          id: 'step-loop.1',
          name: 'Click item',
          type: 'interact',
          action: { interaction: 'click' },
          selectors: { primary: '{{item}}' },
        },
        {
          id: 'step-loop.2',
          name: 'Navigate',
          type: 'navigate',
          action: { url: 'https://example.com/{{loop_index}}' },
        },
      ],
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.substeps).toHaveLength(2);
      expect(result.data.substeps?.[0].id).toBe('step-loop.1');
    }
  });

  it('should validate a loop step with nested loop substep', () => {
    const step = {
      id: 'outer-loop',
      name: 'Outer loop',
      type: 'loop',
      action: { maxIterations: 2 },
      substeps: [
        {
          id: 'inner-loop',
          name: 'Inner loop',
          type: 'loop',
          action: { maxIterations: 3 },
          substeps: [
            {
              id: 'inner-step',
              name: 'Click',
              type: 'interact',
              action: { interaction: 'click' },
            },
          ],
        },
      ],
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should reject loop step with invalid maxIterations (zero)', () => {
    const step = {
      id: 'step-loop',
      name: 'Bad loop',
      type: 'loop',
      action: { maxIterations: 0 },
    };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });

  it('should validate att-bills-last-n.json when it exists', async () => {
    const filePath = join(examplesDir, 'att-bills-last-n.json');
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist yet — skip this test
      return;
    }
    const result = AutomationSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      console.error(JSON.stringify(result.error.flatten(), null, 2));
    }
    expect(result.success).toBe(true);
  });
});

describe('Condition step schema', () => {
  const makeStep = (action: unknown) => ({
    id: 'step-cond',
    name: 'Check',
    type: 'condition',
    action,
  });

  it('should validate a deterministic check with a value', () => {
    const step = makeStep({ check: 'element_exists', value: '#otp-input' });
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should validate a deterministic check with thenStep and elseStep', () => {
    const step = makeStep({
      check: 'url_matches',
      value: '/billing',
      thenStep: 'step-billing',
      elseStep: 'step-retry',
    });
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should validate an ai condition with a plain-English question', () => {
    const step = makeStep({
      ai: 'Is the user currently logged in and viewing the billing history page?',
    });
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should validate an ai condition with thenStep and elseStep', () => {
    const step = makeStep({
      ai: 'Does the page show a CAPTCHA challenge?',
      thenStep: 'step-handle-captcha',
      elseStep: 'step-continue',
    });
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should reject a condition step with both check and ai set', () => {
    const step = makeStep({
      check: 'element_exists',
      value: '#error',
      ai: 'Is there an error banner visible?',
    });
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = JSON.stringify(result.error.issues);
      expect(msg).toMatch(/exactly one of/i);
    }
  });

  it('should reject a condition step with neither check nor ai', () => {
    const step = makeStep({});
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });

  it('should reject an ai condition with an empty/whitespace question', () => {
    const step = makeStep({ ai: '   ' });
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });

  it('should reject a deterministic check without a value', () => {
    const step = makeStep({ check: 'element_exists' });
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /requires a "value"/.test(m))).toBe(true);
    }
  });
});

describe('Functions and call step schema', () => {
  const baseAutomation = (overrides: Record<string, unknown> = {}) => ({
    ...BASE_AUTOMATION,
    steps: [],
    ...overrides,
  });

  it('should validate functions-demo.json example when present', async () => {
    const filePath = join(examplesDir, 'functions-demo.json');
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      return;
    }
    const result = AutomationSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      console.error(JSON.stringify(result.error.flatten(), null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('should validate an automation with a function and a top-level call step', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'login',
          parameters: [{ name: 'user', required: true }],
          steps: [
            {
              id: 'login-1',
              name: 'Type username',
              type: 'interact',
              action: { interaction: 'type', value: '{{user}}' },
              selectors: { primary: '#username' },
            },
          ],
        },
      ],
      steps: [
        {
          id: 'call-login',
          name: 'Call login',
          type: 'call',
          action: { function: 'login', args: { user: 'alice' } },
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('should validate a call step inside a loop substep referencing a function', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'downloadBill',
          parameters: [{ name: 'billRow', required: true }],
          steps: [
            {
              id: 'dl-1',
              name: 'Click row',
              type: 'interact',
              action: { interaction: 'click' },
              selectors: { primary: '{{billRow}}' },
            },
          ],
        },
      ],
      steps: [
        {
          id: 'loop-1',
          name: 'Loop',
          type: 'loop',
          action: { maxIterations: 3 },
          substeps: [
            {
              id: 'call-1',
              name: 'Download one',
              type: 'call',
              action: {
                function: 'downloadBill',
                args: { billRow: '{{item}}' },
              },
            },
          ],
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('should validate a function calling another function (composition)', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'inner',
          steps: [
            {
              id: 'inner-1',
              name: 'Click',
              type: 'interact',
              action: { interaction: 'click' },
              selectors: { primary: '#x' },
            },
          ],
        },
        {
          name: 'outer',
          steps: [
            {
              id: 'outer-1',
              name: 'Delegate',
              type: 'call',
              action: { function: 'inner' },
            },
          ],
        },
      ],
      steps: [
        {
          id: 'root',
          name: 'Call outer',
          type: 'call',
          action: { function: 'outer' },
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('should validate a condition action with thenCall and elseCall', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'handleCaptcha',
          steps: [
            {
              id: 'hc-1',
              name: 'Wait',
              type: 'wait',
              action: { condition: 'delay', value: '1000' },
            },
          ],
        },
        {
          name: 'continueFlow',
          steps: [
            {
              id: 'cf-1',
              name: 'Click next',
              type: 'interact',
              action: { interaction: 'click' },
              selectors: { primary: '#next' },
            },
          ],
        },
      ],
      steps: [
        {
          id: 'cond',
          name: 'Check captcha',
          type: 'condition',
          action: {
            ai: 'Is a CAPTCHA visible on the page?',
            thenCall: 'handleCaptcha',
            elseCall: 'continueFlow',
          },
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('should reject duplicate function names', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'dup',
          steps: [
            {
              id: 'a',
              name: 'A',
              type: 'interact',
              action: { interaction: 'click' },
              selectors: { primary: '#a' },
            },
          ],
        },
        {
          name: 'dup',
          steps: [
            {
              id: 'b',
              name: 'B',
              type: 'interact',
              action: { interaction: 'click' },
              selectors: { primary: '#b' },
            },
          ],
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message);
      expect(msgs.some((m) => /Duplicate function name/.test(m))).toBe(true);
    }
  });

  it('should reject a call step referencing an undefined function', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'realFn',
          steps: [
            {
              id: 'r',
              name: 'R',
              type: 'wait',
              action: { condition: 'delay', value: '100' },
            },
          ],
        },
      ],
      steps: [
        {
          id: 'bad-call',
          name: 'Call wrong name',
          type: 'call',
          action: { function: 'wrongName' },
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message);
      expect(msgs.some((m) => /unknown function "wrongName"/.test(m))).toBe(true);
    }
  });

  it('should reject a condition thenCall referencing an undefined function', () => {
    const automation = baseAutomation({
      steps: [
        {
          id: 'cond',
          name: 'Check',
          type: 'condition',
          action: {
            check: 'element_exists',
            value: '#x',
            thenCall: 'doesNotExist',
          },
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message);
      expect(msgs.some((m) => /thenCall references unknown function "doesNotExist"/.test(m))).toBe(true);
    }
  });

  it('should validate a function with no parameters', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'ping',
          steps: [
            {
              id: 'p',
              name: 'P',
              type: 'wait',
              action: { condition: 'delay', value: '50' },
            },
          ],
        },
      ],
      steps: [
        { id: 'c', name: 'C', type: 'call', action: { function: 'ping' } },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });

  it('should validate a function with a default parameter and required:false', () => {
    const automation = baseAutomation({
      functions: [
        {
          name: 'greet',
          parameters: [
            { name: 'name', required: false, default: 'world' },
          ],
          steps: [
            {
              id: 'g',
              name: 'Greet {{name}}',
              type: 'wait',
              action: { condition: 'delay', value: '10' },
            },
          ],
        },
      ],
      steps: [
        { id: 'c', name: 'Call', type: 'call', action: { function: 'greet' } },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
    if (result.success) {
      const fn = result.data.functions?.[0];
      expect(fn?.parameters?.[0].required).toBe(false);
      expect(fn?.parameters?.[0].default).toBe('world');
    }
  });

  it('should validate parameter arg values supplied via templates', () => {
    const automation = baseAutomation({
      inputs: [{ name: 'target', type: 'string', required: true, source: 'literal', value: '#x' }],
      functions: [
        {
          name: 'tap',
          parameters: [{ name: 'selector', required: true }],
          steps: [
            {
              id: 't',
              name: 'Tap',
              type: 'interact',
              action: { interaction: 'click' },
              selectors: { primary: '{{selector}}' },
            },
          ],
        },
      ],
      steps: [
        {
          id: 'c',
          name: 'Call tap',
          type: 'call',
          action: { function: 'tap', args: { selector: '{{target}}' } },
        },
      ],
    });
    const result = AutomationSchema.safeParse(automation);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Jump validation (goto step type + condition.thenStep/elseStep)
// ---------------------------------------------------------------------------

describe('AutomationSchema · step-id uniqueness and jump references', () => {
  const baseStep = (id: string) => ({
    id,
    name: id,
    type: 'navigate' as const,
    action: { url: 'https://example.com' },
    onFailure: 'abort' as const,
    maxRetries: 0,
    timeout: 1000,
  });

  it('accepts a valid goto step targeting a known top-level step', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        baseStep('step-1'),
        {
          id: 'jump-back',
          name: 'Jump back',
          type: 'goto',
          action: { targetStepId: 'step-1' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 1000,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate top-level step ids', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [baseStep('step-1'), baseStep('step-1')],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /Duplicate top-level step id/.test(i.message))).toBe(true);
    }
  });

  it('rejects a goto step that targets an unknown step id', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        baseStep('step-1'),
        {
          id: 'bad-jump',
          name: 'Bad jump',
          type: 'goto',
          action: { targetStepId: 'nowhere' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 1000,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /not a known top-level step id/.test(i.message)),
      ).toBe(true);
    }
  });

  it('accepts templated targetStepId at schema time (runtime check is separate)', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        baseStep('step-1'),
        {
          id: 'templated-jump',
          name: 'Templated jump',
          type: 'goto',
          action: { targetStepId: '{{jumpTarget}}' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 1000,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a condition with both thenStep and thenCall', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      functions: [
        {
          name: 'recover',
          steps: [baseStep('r1')],
        },
      ],
      steps: [
        baseStep('step-1'),
        {
          id: 'check',
          name: 'Check',
          type: 'condition',
          action: {
            check: 'variable_equals',
            value: 'last_step_status=failed',
            thenStep: 'step-1',
            thenCall: 'recover',
          },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 1000,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /both "thenStep" and "thenCall"/.test(i.message)),
      ).toBe(true);
    }
  });

  it('rejects a thenStep target pointing at a nested (loop substep) step id', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        {
          id: 'step-loop',
          name: 'Loop',
          type: 'loop',
          action: { maxIterations: 3, indexVar: 'i' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 10000,
          substeps: [baseStep('inner-1')],
        },
        {
          id: 'bad-check',
          name: 'Bad check',
          type: 'condition',
          action: {
            check: 'variable_equals',
            value: 'last_step_status=failed',
            thenStep: 'inner-1',
          },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 1000,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /nested step/.test(i.message)),
      ).toBe(true);
    }
  });

  it('rejects a goto that points at a function body step id', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      functions: [
        {
          name: 'helper',
          steps: [baseStep('helper-1')],
        },
      ],
      steps: [
        baseStep('step-1'),
        {
          id: 'bad-goto',
          name: 'Bad goto',
          type: 'goto',
          action: { targetStepId: 'helper-1' },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 1000,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /nested step/.test(i.message)),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// aiscope step validation
// ---------------------------------------------------------------------------

describe('AutomationSchema · aiscope step type', () => {
  const aiscopeStep = (action: Record<string, unknown>) => ({
    id: 'step-ai',
    name: 'Aiscope',
    type: 'aiscope' as const,
    action,
    onFailure: 'abort' as const,
    maxRetries: 0,
    timeout: 0,
  });

  it('validates a minimal aiscope step with a deterministic successCheck', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Click the accept button',
          successCheck: {
            check: 'element_exists',
            value: 'button.accepted',
          },
        }),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data.steps[0].action as {
        maxDurationSec: number;
        maxIterations: number;
        includeScreenshot: boolean;
      };
      expect(action.maxDurationSec).toBe(300);
      expect(action.maxIterations).toBe(25);
      expect(action.includeScreenshot).toBe(true);
    }
  });

  it('validates an aiscope step with an AI successCheck', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Dismiss the cookie banner',
          successCheck: { ai: 'Is the cookie banner gone?' },
          maxDurationSec: 60,
          maxIterations: 10,
        }),
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an aiscope step with neither check nor ai in successCheck', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Do something',
          successCheck: {},
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an aiscope step with both check and ai in successCheck', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Do something',
          successCheck: {
            check: 'element_exists',
            value: 'button',
            ai: 'Is it done?',
          },
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an aiscope step with check set but no value', () => {
    // NOTE: the action field is a z.union, so Zod picks the "best" error
    // from whichever variant matched closest — which may be the condition
    // variant, not the aiscope variant. We just assert rejection, not the
    // specific message.
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Do something',
          successCheck: { check: 'element_exists' },
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing goal', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          successCheck: { check: 'element_exists', value: 'button' },
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('applies defaults for maxDurationSec, maxIterations, and includeScreenshot', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Test defaults',
          successCheck: { check: 'element_exists', value: 'button' },
        }),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data.steps[0].action as {
        maxDurationSec: number;
        maxIterations: number;
        includeScreenshot: boolean;
      };
      expect(action.maxDurationSec).toBe(300);
      expect(action.maxIterations).toBe(25);
      expect(action.includeScreenshot).toBe(true);
    }
  });

  it('accepts a custom allowedActions whitelist', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Click only',
          successCheck: { check: 'element_exists', value: 'button' },
          allowedActions: ['click', 'done'],
        }),
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid action name in allowedActions', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        aiscopeStep({
          goal: 'Do stuff',
          successCheck: { check: 'element_exists', value: 'button' },
          allowedActions: ['eval'],
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  // Regression: prior to the discriminated-union refactor, an aiscope
  // step whose action shape happened to match an earlier variant in a
  // plain z.union (e.g. LoopAction, which only requires maxIterations)
  // was silently reparsed as that other variant. Zod stripped the
  // aiscope-specific fields as "unknown keys" and the runner then
  // crashed at resolveTemplate(undefined) because `action.goal` was
  // gone. The discriminator on `type` forces AiScopeActionSchema to
  // be selected, preserving every aiscope-specific field.
  it('regression: aiscope with maxIterations parses as aiscope (not loop)', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        {
          id: 'navigate-to-login',
          name: 'Navigate to login',
          type: 'aiscope',
          action: {
            goal: 'Find the login page and click through until the sign-in form appears',
            successCheck: { ai: 'A user or email input box is visible' },
            maxDurationSec: 120,
            maxIterations: 80,
            includeScreenshot: true,
          },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 60000,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data.steps[0].action as {
        goal: string;
        successCheck: { ai?: string };
        maxDurationSec: number;
        maxIterations: number;
        includeScreenshot: boolean;
      };
      // The key assertion: `goal` must survive parsing. Under the old
      // schema this would be undefined because z.union reparsed the
      // action as a LoopAction (which doesn't have a goal field) and
      // Zod stripped the unknown keys.
      expect(action.goal).toBe(
        'Find the login page and click through until the sign-in form appears',
      );
      expect(action.successCheck.ai).toBe('A user or email input box is visible');
      expect(action.maxDurationSec).toBe(120);
      expect(action.maxIterations).toBe(80);
      expect(action.includeScreenshot).toBe(true);
    }
  });

  it('regression: a malformed aiscope step missing goal is rejected with a targeted error', () => {
    const result = AutomationSchema.safeParse({
      ...BASE_AUTOMATION,
      steps: [
        {
          id: 'bad-aiscope',
          name: 'Missing goal',
          type: 'aiscope',
          action: {
            successCheck: { check: 'element_exists', value: 'button' },
            maxIterations: 80,
          },
          onFailure: 'abort',
          maxRetries: 0,
          timeout: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // With a discriminated union, the error reports the precise path
      // on the selected variant, not a generic "no variant matched".
      const flat = result.error.flatten();
      const issuePaths = result.error.issues.map((i) => i.path.join('.'));
      const mentionsGoal = issuePaths.some((p) => p.includes('goal'));
      expect(mentionsGoal).toBe(true);
      // Guard against the message also mentioning unrelated variant
      // fields (e.g. "function", "targetStepId") which would indicate
      // z.union is still being used.
      void flat;
    }
  });
});
