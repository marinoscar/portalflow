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
