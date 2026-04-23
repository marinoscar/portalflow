import { describe, it, expect } from 'vitest';
import type { Automation, Step } from '@portalflow/schema';
import {
  parseNodeId,
  encodeNodeId,
  getStepAtPath,
  getFunctionStepAtPath,
  type SelectedNode,
} from '../selection';

// ---------------------------------------------------------------------------
// encodeNodeId / parseNodeId round-trips
// ---------------------------------------------------------------------------

describe('encodeNodeId + parseNodeId round-trips', () => {
  const cases: Array<{ node: SelectedNode; encoded: string }> = [
    { node: { kind: 'none' }, encoded: '' },
    { node: { kind: 'metadata' }, encoded: 'metadata' },
    { node: { kind: 'input', index: 0 }, encoded: 'input:0' },
    { node: { kind: 'input', index: 2 }, encoded: 'input:2' },
    { node: { kind: 'step', path: [0] }, encoded: 'step:0' },
    { node: { kind: 'step', path: [2, 0, 1] }, encoded: 'step:2.0.1' },
    { node: { kind: 'function', index: 3 }, encoded: 'function:3' },
    { node: { kind: 'function', index: 3, stepPath: [0] }, encoded: 'function:3:step:0' },
    { node: { kind: 'function', index: 3, stepPath: [0, 1] }, encoded: 'function:3:step:0.1' },
    { node: { kind: 'function', index: 0, stepPath: [1, 2, 3] }, encoded: 'function:0:step:1.2.3' },
  ];

  for (const { node, encoded } of cases) {
    it(`encodeNodeId(${JSON.stringify(node)}) === "${encoded}"`, () => {
      expect(encodeNodeId(node)).toBe(encoded);
    });

    // Skip round-trip for 'none' since encodeNodeId → '' → parseNodeId('')
    // returns {kind:'none'} — this is still a valid identity
    it(`parseNodeId("${encoded}") round-trips back`, () => {
      const result = parseNodeId(encoded);
      if (node.kind === 'none') {
        expect(result.kind).toBe('none');
      } else {
        expect(result).toEqual(node);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// parseNodeId — null / falsy inputs
// ---------------------------------------------------------------------------

describe('parseNodeId — null / empty', () => {
  it('returns {kind:"none"} for null', () => {
    expect(parseNodeId(null)).toEqual({ kind: 'none' });
  });

  it('returns {kind:"none"} for empty string', () => {
    expect(parseNodeId('')).toEqual({ kind: 'none' });
  });
});

// ---------------------------------------------------------------------------
// parseNodeId — malformed inputs return {kind:'none'}
// ---------------------------------------------------------------------------

describe('parseNodeId — malformed inputs', () => {
  it('returns none for "input:abc" (non-numeric index)', () => {
    expect(parseNodeId('input:abc')).toEqual({ kind: 'none' });
  });

  it('returns none for "step:" (empty path)', () => {
    expect(parseNodeId('step:')).toEqual({ kind: 'none' });
  });

  it('returns none for "step:a.b" (non-numeric path segments)', () => {
    expect(parseNodeId('step:a.b')).toEqual({ kind: 'none' });
  });

  it('returns none for "function:abc" (non-numeric fn index)', () => {
    expect(parseNodeId('function:abc')).toEqual({ kind: 'none' });
  });

  it('returns none for "function:0:notStep:1" (bad sub-prefix)', () => {
    expect(parseNodeId('function:0:notStep:1')).toEqual({ kind: 'none' });
  });

  it('returns none for "function:0:step:" (empty step path)', () => {
    expect(parseNodeId('function:0:step:')).toEqual({ kind: 'none' });
  });

  it('returns none for "completely-invalid"', () => {
    expect(parseNodeId('completely-invalid')).toEqual({ kind: 'none' });
  });
});

// ---------------------------------------------------------------------------
// getStepAtPath
// ---------------------------------------------------------------------------

function makeStep(id: string): Step {
  return {
    id,
    name: id,
    type: 'navigate',
    action: { url: `https://example.com/${id}` },
    onFailure: 'abort',
    maxRetries: 3,
    timeout: 30000,
  };
}

function withSubsteps(id: string, substeps: Step[]): Step {
  return {
    ...makeStep(id),
    type: 'loop',
    action: { maxIterations: 3, indexVar: 'loop_index' },
    substeps,
  };
}

const FLAT_AUTO: Automation = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'test',
  version: '1.0.0',
  description: '',
  goal: '',
  inputs: [],
  steps: [makeStep('s0'), makeStep('s1'), makeStep('s2')],
};

const NESTED_AUTO: Automation = {
  ...FLAT_AUTO,
  steps: [
    withSubsteps('loop0', [
      makeStep('sub0-0'),
      withSubsteps('sub0-1-loop', [makeStep('deep0'), makeStep('deep1')]),
    ]),
    makeStep('s1'),
  ],
};

describe('getStepAtPath', () => {
  it('resolves a top-level step by index', () => {
    const step = getStepAtPath(FLAT_AUTO, [1]);
    expect(step?.id).toBe('s1');
  });

  it('resolves a nested substep at path [0, 0]', () => {
    const step = getStepAtPath(NESTED_AUTO, [0, 0]);
    expect(step?.id).toBe('sub0-0');
  });

  it('resolves a deeply nested step at path [0, 1, 1]', () => {
    const step = getStepAtPath(NESTED_AUTO, [0, 1, 1]);
    expect(step?.id).toBe('deep1');
  });

  it('returns null for an out-of-bounds top-level index', () => {
    expect(getStepAtPath(FLAT_AUTO, [10])).toBeNull();
  });

  it('returns null for an out-of-bounds substep index', () => {
    expect(getStepAtPath(NESTED_AUTO, [0, 5])).toBeNull();
  });

  it('returns null when path descends into a step with no substeps', () => {
    expect(getStepAtPath(FLAT_AUTO, [0, 0])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFunctionStepAtPath
// ---------------------------------------------------------------------------

const AUTO_WITH_FUNCTIONS: Automation = {
  ...FLAT_AUTO,
  functions: [
    {
      name: 'fn0',
      steps: [makeStep('fn0s0'), makeStep('fn0s1')],
    },
    {
      name: 'fn1',
      steps: [
        withSubsteps('fn1-loop', [makeStep('fn1-sub0'), makeStep('fn1-sub1')]),
        makeStep('fn1-s1'),
      ],
    },
  ],
};

describe('getFunctionStepAtPath', () => {
  it('resolves a top-level function step at [0] in fn0', () => {
    const step = getFunctionStepAtPath(AUTO_WITH_FUNCTIONS, 0, [1]);
    expect(step?.id).toBe('fn0s1');
  });

  it('resolves a nested substep in fn1 at path [0, 1]', () => {
    const step = getFunctionStepAtPath(AUTO_WITH_FUNCTIONS, 1, [0, 1]);
    expect(step?.id).toBe('fn1-sub1');
  });

  it('returns null for an out-of-bounds function index', () => {
    expect(getFunctionStepAtPath(AUTO_WITH_FUNCTIONS, 99, [0])).toBeNull();
  });

  it('returns null for an out-of-bounds step path within a function', () => {
    expect(getFunctionStepAtPath(AUTO_WITH_FUNCTIONS, 0, [10])).toBeNull();
  });

  it('returns null when stepPath descends into a step with no substeps', () => {
    expect(getFunctionStepAtPath(AUTO_WITH_FUNCTIONS, 0, [0, 0])).toBeNull();
  });
});
