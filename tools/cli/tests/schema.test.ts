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
