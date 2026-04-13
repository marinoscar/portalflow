import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutomationSchema } from '@portalflow/schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '..', 'examples');

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
