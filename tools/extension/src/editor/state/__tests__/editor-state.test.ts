import { describe, it, expect } from 'vitest';
import type { Automation, Step, Input, FunctionDefinition } from '@portalflow/schema';
import { AutomationSchema } from '@portalflow/schema';
import {
  editorReducer,
  initialState,
  newEmptyAutomation,
  duplicateStep,
  type EditorState,
} from '../editor-state';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeStep(id: string, name: string = id): Step {
  return {
    id,
    name,
    type: 'navigate',
    action: { url: `https://example.com/${id}` },
    onFailure: 'abort',
    maxRetries: 3,
    timeout: 30000,
  };
}

function makeLoopStep(id: string, substeps: Step[]): Step {
  return {
    id,
    name: `loop-${id}`,
    type: 'loop',
    action: { maxIterations: 5, indexVar: 'loop_index' },
    onFailure: 'abort',
    maxRetries: 0,
    timeout: 30000,
    substeps,
  };
}

function makeInput(name: string): Input {
  return { name, type: 'string', required: true };
}

const BASE_AUTOMATION: Automation = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Test automation',
  version: '1.0.0',
  description: 'desc',
  goal: 'goal',
  inputs: [],
  steps: [
    makeStep('s0', 'Step 0'),
    makeStep('s1', 'Step 1'),
    makeStep('s2', 'Step 2'),
  ],
};

function stateWith(automation: Automation): EditorState {
  return editorReducer(initialState, { type: 'LOAD', payload: automation });
}

// ---------------------------------------------------------------------------
// LOAD / RESET / SELECT_NODE / MARK_CLEAN
// ---------------------------------------------------------------------------

describe('LOAD', () => {
  it('sets automation, clears dirty, and populates validation', () => {
    const state = editorReducer(initialState, { type: 'LOAD', payload: BASE_AUTOMATION });
    expect(state.automation).toEqual(BASE_AUTOMATION);
    expect(state.dirty).toBe(false);
    expect(state.validation.success).toBe(true);
  });

  it('sets selectedNodeId to "metadata" after load', () => {
    const state = editorReducer(initialState, { type: 'LOAD', payload: BASE_AUTOMATION });
    expect(state.selectedNodeId).toBe('metadata');
  });

  it('produces a failing validation for an automation with empty name', () => {
    const bad: Automation = { ...BASE_AUTOMATION, name: '' };
    const state = editorReducer(initialState, { type: 'LOAD', payload: bad });
    expect(state.validation.success).toBe(false);
  });
});

describe('RESET', () => {
  it('clears automation back to null', () => {
    const loaded = editorReducer(initialState, { type: 'LOAD', payload: BASE_AUTOMATION });
    const reset = editorReducer(loaded, { type: 'RESET' });
    expect(reset.automation).toBeNull();
    expect(reset.dirty).toBe(false);
    expect(reset.selectedNodeId).toBeNull();
  });
});

describe('SELECT_NODE', () => {
  it('only updates selectedNodeId, leaving everything else unchanged', () => {
    const loaded = editorReducer(initialState, { type: 'LOAD', payload: BASE_AUTOMATION });
    const selected = editorReducer(loaded, { type: 'SELECT_NODE', payload: 'step:1' });
    expect(selected.selectedNodeId).toBe('step:1');
    expect(selected.automation).toBe(loaded.automation);
    expect(selected.dirty).toBe(loaded.dirty);
  });

  it('accepts null to deselect', () => {
    const loaded = editorReducer(initialState, { type: 'LOAD', payload: BASE_AUTOMATION });
    const state = editorReducer(loaded, { type: 'SELECT_NODE', payload: null });
    expect(state.selectedNodeId).toBeNull();
  });
});

describe('MARK_CLEAN', () => {
  it('sets dirty to false without changing automation', () => {
    let state = stateWith(BASE_AUTOMATION);
    // Make it dirty
    state = editorReducer(state, {
      type: 'UPDATE_METADATA',
      payload: { name: 'New name' },
    });
    expect(state.dirty).toBe(true);
    const cleaned = editorReducer(state, { type: 'MARK_CLEAN' });
    expect(cleaned.dirty).toBe(false);
    expect(cleaned.automation?.name).toBe('New name');
  });
});

// ---------------------------------------------------------------------------
// UPDATE_METADATA
// ---------------------------------------------------------------------------

describe('UPDATE_METADATA', () => {
  it('merges partial changes and marks dirty', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, {
      type: 'UPDATE_METADATA',
      payload: { name: 'Renamed', goal: 'New goal' },
    });
    expect(state.automation?.name).toBe('Renamed');
    expect(state.automation?.goal).toBe('New goal');
    expect(state.automation?.description).toBe('desc'); // unchanged
    expect(state.dirty).toBe(true);
  });

  it('reruns validation after update', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, {
      type: 'UPDATE_METADATA',
      payload: { name: '' },
    });
    expect(state.validation.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ADD_INPUT / UPDATE_INPUT / REMOVE_INPUT
// ---------------------------------------------------------------------------

describe('ADD_INPUT', () => {
  it('appends input and marks dirty', () => {
    let state = stateWith(BASE_AUTOMATION);
    const input = makeInput('username');
    state = editorReducer(state, { type: 'ADD_INPUT', payload: input });
    expect(state.automation?.inputs).toHaveLength(1);
    expect(state.automation?.inputs[0].name).toBe('username');
    expect(state.dirty).toBe(true);
  });
});

describe('UPDATE_INPUT', () => {
  it('merges changes at the given index and marks dirty', () => {
    const auto: Automation = { ...BASE_AUTOMATION, inputs: [makeInput('a'), makeInput('b')] };
    let state = stateWith(auto);
    state = editorReducer(state, {
      type: 'UPDATE_INPUT',
      payload: { index: 1, changes: { required: false } },
    });
    expect(state.automation?.inputs[1].required).toBe(false);
    expect(state.automation?.inputs[0].required).toBe(true); // sibling unchanged
    expect(state.dirty).toBe(true);
  });
});

describe('REMOVE_INPUT', () => {
  it('removes at the given index and marks dirty', () => {
    const auto: Automation = { ...BASE_AUTOMATION, inputs: [makeInput('a'), makeInput('b'), makeInput('c')] };
    let state = stateWith(auto);
    state = editorReducer(state, { type: 'REMOVE_INPUT', payload: { index: 1 } });
    expect(state.automation?.inputs.map((i) => i.name)).toEqual(['a', 'c']);
    expect(state.dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ADD_FUNCTION / UPDATE_FUNCTION / REMOVE_FUNCTION
// ---------------------------------------------------------------------------

const FUNC: FunctionDefinition = {
  name: 'doLogin',
  steps: [makeStep('fs0', 'func-step')],
};

describe('ADD_FUNCTION', () => {
  it('appends function and marks dirty', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, { type: 'ADD_FUNCTION', payload: FUNC });
    expect(state.automation?.functions).toHaveLength(1);
    expect(state.automation?.functions![0].name).toBe('doLogin');
    expect(state.dirty).toBe(true);
  });
});

describe('UPDATE_FUNCTION', () => {
  it('merges changes at the given index and marks dirty', () => {
    const auto: Automation = { ...BASE_AUTOMATION, functions: [FUNC] };
    let state = stateWith(auto);
    state = editorReducer(state, {
      type: 'UPDATE_FUNCTION',
      payload: { index: 0, changes: { description: 'logs in' } },
    });
    expect(state.automation?.functions![0].description).toBe('logs in');
    expect(state.automation?.functions![0].name).toBe('doLogin'); // name unchanged
    expect(state.dirty).toBe(true);
  });
});

describe('REMOVE_FUNCTION', () => {
  it('removes at the given index and marks dirty', () => {
    const funcB: FunctionDefinition = { name: 'doLogout', steps: [] };
    const auto: Automation = { ...BASE_AUTOMATION, functions: [FUNC, funcB] };
    let state = stateWith(auto);
    state = editorReducer(state, { type: 'REMOVE_FUNCTION', payload: { index: 0 } });
    expect(state.automation?.functions).toHaveLength(1);
    expect(state.automation?.functions![0].name).toBe('doLogout');
    expect(state.dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UPDATE_STEP
// ---------------------------------------------------------------------------

describe('UPDATE_STEP — top-level', () => {
  it('edits top-level step at index 2 and marks dirty', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, {
      type: 'UPDATE_STEP',
      payload: { path: [2], changes: { name: 'Renamed step 2' } },
    });
    expect(state.automation?.steps[2].name).toBe('Renamed step 2');
    expect(state.automation?.steps[0].name).toBe('Step 0'); // sibling unchanged
    expect(state.dirty).toBe(true);
  });

  it('edits a substep inside a loop at path [0, 1]', () => {
    const auto: Automation = {
      ...BASE_AUTOMATION,
      steps: [
        makeLoopStep('loop0', [makeStep('sub0', 'sub 0'), makeStep('sub1', 'sub 1')]),
        makeStep('s1', 'Step 1'),
      ],
    };
    let state = stateWith(auto);
    state = editorReducer(state, {
      type: 'UPDATE_STEP',
      payload: { path: [0, 1], changes: { name: 'Renamed sub 1' } },
    });
    expect(state.automation?.steps[0].substeps![1].name).toBe('Renamed sub 1');
    expect(state.automation?.steps[0].substeps![0].name).toBe('sub 0'); // sibling unchanged
    expect(state.dirty).toBe(true);
  });

  it('edits a step inside functions[1].steps[0] when functionIndex is provided', () => {
    const func0: FunctionDefinition = { name: 'fn0', steps: [makeStep('fn0s0')] };
    const func1: FunctionDefinition = { name: 'fn1', steps: [makeStep('fn1s0', 'original')] };
    const auto: Automation = { ...BASE_AUTOMATION, functions: [func0, func1] };
    let state = stateWith(auto);
    state = editorReducer(state, {
      type: 'UPDATE_STEP',
      payload: { path: [0], changes: { name: 'Updated fn1 step' }, functionIndex: 1 },
    });
    expect(state.automation?.functions![1].steps[0].name).toBe('Updated fn1 step');
    expect(state.automation?.functions![0].steps[0].name).toBe('fn0s0'); // other fn unchanged
    expect(state.dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// INSERT_STEP
// ---------------------------------------------------------------------------

describe('INSERT_STEP', () => {
  it('inserts before the target position', () => {
    let state = stateWith(BASE_AUTOMATION);
    const newStep = makeStep('new', 'New');
    state = editorReducer(state, {
      type: 'INSERT_STEP',
      payload: { path: [1], step: newStep, position: 'before' },
    });
    const steps = state.automation!.steps;
    expect(steps[1].id).toBe('new');
    expect(steps[2].id).toBe('s1');
    expect(state.dirty).toBe(true);
  });

  it('inserts after the target position', () => {
    let state = stateWith(BASE_AUTOMATION);
    const newStep = makeStep('new', 'New');
    state = editorReducer(state, {
      type: 'INSERT_STEP',
      payload: { path: [1], step: newStep, position: 'after' },
    });
    const steps = state.automation!.steps;
    expect(steps[2].id).toBe('new');
    expect(steps[1].id).toBe('s1');
    expect(state.dirty).toBe(true);
  });

  it('appends a substep into a loop step', () => {
    const auto: Automation = {
      ...BASE_AUTOMATION,
      steps: [makeLoopStep('loop0', [makeStep('sub0')]), makeStep('s1')],
    };
    let state = stateWith(auto);
    const newSubstep = makeStep('sub1', 'Substep 1');
    state = editorReducer(state, {
      type: 'INSERT_STEP',
      payload: { path: [0], step: newSubstep, position: 'append-substep' },
    });
    const substeps = state.automation!.steps[0].substeps!;
    expect(substeps).toHaveLength(2);
    expect(substeps[1].id).toBe('sub1');
    expect(state.dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MOVE_STEP
// ---------------------------------------------------------------------------

describe('MOVE_STEP', () => {
  it('moves step up from index 1 to index 0', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, {
      type: 'MOVE_STEP',
      payload: { path: [1], direction: 'up' },
    });
    const ids = state.automation!.steps.map((s) => s.id);
    expect(ids[0]).toBe('s1');
    expect(ids[1]).toBe('s0');
    expect(state.dirty).toBe(true);
  });

  it('cannot move-up the first step (noop)', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, {
      type: 'MOVE_STEP',
      payload: { path: [0], direction: 'up' },
    });
    const ids = state.automation!.steps.map((s) => s.id);
    expect(ids).toEqual(['s0', 's1', 's2']);
  });

  it('cannot move-down the last step (noop)', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, {
      type: 'MOVE_STEP',
      payload: { path: [2], direction: 'down' },
    });
    const ids = state.automation!.steps.map((s) => s.id);
    expect(ids).toEqual(['s0', 's1', 's2']);
  });
});

// ---------------------------------------------------------------------------
// REMOVE_STEP
// ---------------------------------------------------------------------------

describe('REMOVE_STEP', () => {
  it('removes the step at the given path without affecting siblings', () => {
    let state = stateWith(BASE_AUTOMATION);
    state = editorReducer(state, {
      type: 'REMOVE_STEP',
      payload: { path: [1] },
    });
    const ids = state.automation!.steps.map((s) => s.id);
    expect(ids).toEqual(['s0', 's2']);
    expect(state.dirty).toBe(true);
  });

  it('removes a nested substep without affecting siblings', () => {
    const auto: Automation = {
      ...BASE_AUTOMATION,
      steps: [
        makeLoopStep('loop0', [makeStep('sub0'), makeStep('sub1'), makeStep('sub2')]),
      ],
    };
    let state = stateWith(auto);
    state = editorReducer(state, {
      type: 'REMOVE_STEP',
      payload: { path: [0, 1] },
    });
    const substepIds = state.automation!.steps[0].substeps!.map((s) => s.id);
    expect(substepIds).toEqual(['sub0', 'sub2']);
    expect(state.dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// newEmptyAutomation
// ---------------------------------------------------------------------------

describe('newEmptyAutomation', () => {
  it('produces a schema-valid automation', () => {
    const auto = newEmptyAutomation();
    const result = AutomationSchema.safeParse(auto);
    expect(result.success).toBe(true);
  });

  it('produces an automation with empty inputs and steps', () => {
    const auto = newEmptyAutomation();
    expect(auto.inputs).toHaveLength(0);
    expect(auto.steps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Mutating actions all set dirty: true and rerun validation
// ---------------------------------------------------------------------------

describe('mutating actions', () => {
  const MUTATING_ACTIONS = [
    { type: 'UPDATE_METADATA' as const, payload: { name: 'x' } },
    { type: 'ADD_INPUT' as const, payload: makeInput('x') },
    { type: 'UPDATE_INPUT' as const, payload: { index: 0, changes: {} } },
    { type: 'REMOVE_INPUT' as const, payload: { index: 0 } },
    { type: 'UPDATE_STEP' as const, payload: { path: [0], changes: { name: 'x' } } },
    { type: 'INSERT_STEP' as const, payload: { path: [0], step: makeStep('ns'), position: 'after' as const } },
    { type: 'MOVE_STEP' as const, payload: { path: [1], direction: 'up' as const } },
    { type: 'REMOVE_STEP' as const, payload: { path: [0] } },
    { type: 'ADD_FUNCTION' as const, payload: { name: 'fn', steps: [] } },
    { type: 'UPDATE_FUNCTION' as const, payload: { index: 0, changes: {} } },
    { type: 'REMOVE_FUNCTION' as const, payload: { index: 0 } },
    { type: 'DUPLICATE_STEP' as const, payload: { path: [0] } },
  ] as const;

  for (const action of MUTATING_ACTIONS) {
    it(`${action.type} sets dirty: true`, () => {
      const auto: Automation = {
        ...BASE_AUTOMATION,
        inputs: [makeInput('pre')],
        functions: [{ name: 'fn', steps: [] }],
      };
      const state = stateWith(auto);
      expect(state.dirty).toBe(false);
      const next = editorReducer(state, action as Parameters<typeof editorReducer>[1]);
      expect(next.dirty).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// duplicateStep — pure function tests
// ---------------------------------------------------------------------------

describe('duplicateStep (pure helper)', () => {
  it('returns a new step with a different id', () => {
    const src = makeStep('orig', 'Original');
    const copy = duplicateStep(src);
    expect(copy.id).not.toBe(src.id);
  });

  it('appends " (copy)" to the name', () => {
    const src = makeStep('orig', 'My Step');
    const copy = duplicateStep(src);
    expect(copy.name).toBe('My Step (copy)');
  });

  it('uses fallback name "Step (copy)" when source name is empty', () => {
    const src: Step = { ...makeStep('orig'), name: '' };
    const copy = duplicateStep(src);
    expect(copy.name).toBe('Step (copy)');
  });

  it('deep-copies all other fields', () => {
    const src = makeStep('orig', 'Src');
    const copy = duplicateStep(src);
    expect(copy.type).toBe(src.type);
    expect(copy.action).toEqual(src.action);
    expect(copy.onFailure).toBe(src.onFailure);
    expect(copy.maxRetries).toBe(src.maxRetries);
    expect(copy.timeout).toBe(src.timeout);
  });

  it('recursively assigns fresh ids to substeps inside a loop', () => {
    const sub1 = makeStep('sub1', 'Sub 1');
    const sub2 = makeStep('sub2', 'Sub 2');
    const loop = makeLoopStep('loop1', [sub1, sub2]);
    const copy = duplicateStep(loop);

    expect(copy.id).not.toBe(loop.id);
    const copySubs = copy.substeps!;
    expect(copySubs).toHaveLength(2);
    expect(copySubs[0].id).not.toBe(sub1.id);
    expect(copySubs[1].id).not.toBe(sub2.id);
    // Ids in the copy must also differ from each other
    expect(copySubs[0].id).not.toBe(copySubs[1].id);
  });

  it('recursively renames substeps', () => {
    const sub = makeStep('sub1', 'Inner');
    const loop = makeLoopStep('loop1', [sub]);
    const copy = duplicateStep(loop);
    expect(copy.substeps![0].name).toBe('Inner (copy)');
  });
});

// ---------------------------------------------------------------------------
// DUPLICATE_STEP reducer
// ---------------------------------------------------------------------------

describe('DUPLICATE_STEP', () => {
  // --- top-level step ---

  it('inserts a new step at index + 1 when duplicating a top-level step', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [1] },
    });
    const steps = next.automation!.steps;
    expect(steps).toHaveLength(4);
    expect(steps[1].id).toBe('s1');        // original still in place
    expect(steps[2].id).not.toBe('s1');    // new copy after it
    expect(steps[3].id).toBe('s2');        // old index 2 shifted to 3
  });

  it('gives the duplicate a new id (not equal to source)', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0] },
    });
    const original = BASE_AUTOMATION.steps[0];
    const copy = next.automation!.steps[1];
    expect(copy.id).not.toBe(original.id);
  });

  it('names the duplicate "<source.name> (copy)"', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0] },
    });
    expect(next.automation!.steps[1].name).toBe('Step 0 (copy)');
  });

  it('all other fields match the source (deep equality on action)', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0] },
    });
    const src = BASE_AUTOMATION.steps[0];
    const copy = next.automation!.steps[1];
    expect(copy.type).toBe(src.type);
    expect(copy.action).toEqual(src.action);
    expect(copy.onFailure).toBe(src.onFailure);
    expect(copy.maxRetries).toBe(src.maxRetries);
    expect(copy.timeout).toBe(src.timeout);
  });

  it('sets dirty to true', () => {
    const state = stateWith(BASE_AUTOMATION);
    expect(state.dirty).toBe(false);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0] },
    });
    expect(next.dirty).toBe(true);
  });

  it('sets selectedNodeId to the encoded id of the new step (e.g. "step:3" when duplicating at [2])', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [2] },
    });
    // Duplicating at [2] → new step lands at [3]
    expect(next.selectedNodeId).toBe('step:3');
  });

  it('selectedNodeId is "step:1" when duplicating at [0]', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0] },
    });
    expect(next.selectedNodeId).toBe('step:1');
  });

  it('reruns validation and returns a valid SafeParseReturnType', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0] },
    });
    expect(next.validation).toHaveProperty('success');
    expect(typeof next.validation.success).toBe('boolean');
  });

  // --- loop substeps ---

  it('recursively duplicates loop substeps with fresh ids', () => {
    const sub1 = makeStep('sub1', 'Sub 1');
    const sub2 = makeStep('sub2', 'Sub 2');
    const loopAuto: Automation = {
      ...BASE_AUTOMATION,
      steps: [makeLoopStep('loop0', [sub1, sub2])],
    };
    const state = stateWith(loopAuto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0] },
    });
    const copy = next.automation!.steps[1];
    expect(copy.substeps).toHaveLength(2);
    expect(copy.substeps![0].id).not.toBe(sub1.id);
    expect(copy.substeps![1].id).not.toBe(sub2.id);
    // Ensure original is unchanged
    expect(next.automation!.steps[0].substeps![0].id).toBe(sub1.id);
  });

  // --- substep inside a loop ---

  it('inserts at [0, 2] when duplicating substep at path [0, 1]', () => {
    const sub0 = makeStep('sub0', 'Sub 0');
    const sub1 = makeStep('sub1', 'Sub 1');
    const sub2 = makeStep('sub2', 'Sub 2');
    const loopAuto: Automation = {
      ...BASE_AUTOMATION,
      steps: [makeLoopStep('loop0', [sub0, sub1, sub2])],
    };
    const state = stateWith(loopAuto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0, 1] },
    });
    const substeps = next.automation!.steps[0].substeps!;
    expect(substeps).toHaveLength(4);
    expect(substeps[1].id).toBe(sub1.id);     // original still at [0,1]
    expect(substeps[2].id).not.toBe(sub1.id); // copy inserted at [0,2]
    expect(substeps[2].name).toBe('Sub 1 (copy)');
    expect(substeps[3].id).toBe(sub2.id);     // old [0,2] shifted to [0,3]
  });

  it('selectedNodeId encodes the substep position when duplicating a substep', () => {
    const loopAuto: Automation = {
      ...BASE_AUTOMATION,
      steps: [makeLoopStep('loop0', [makeStep('sub0'), makeStep('sub1')])],
    };
    const state = stateWith(loopAuto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0, 1] },
    });
    // Duplicating [0,1] → new step at [0,2]
    expect(next.selectedNodeId).toBe('step:0.2');
  });

  // --- function-body steps ---

  it('duplicates a function-body step and inserts at the next index', () => {
    const fn0: FunctionDefinition = {
      name: 'fn0',
      steps: [makeStep('fn0s0', 'Fn Step 0'), makeStep('fn0s1', 'Fn Step 1')],
    };
    const auto: Automation = { ...BASE_AUTOMATION, functions: [fn0] };
    const state = stateWith(auto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0], functionIndex: 0 },
    });
    const fnSteps = next.automation!.functions![0].steps;
    expect(fnSteps).toHaveLength(3);
    expect(fnSteps[0].id).toBe('fn0s0');          // original at [0]
    expect(fnSteps[1].id).not.toBe('fn0s0');       // copy inserted at [1]
    expect(fnSteps[1].name).toBe('Fn Step 0 (copy)');
    expect(fnSteps[2].id).toBe('fn0s1');           // old [1] shifted to [2]
  });

  it('selectedNodeId encodes the function step position', () => {
    const fn0: FunctionDefinition = {
      name: 'fn0',
      steps: [makeStep('fn0s0', 'Fn Step 0'), makeStep('fn0s1', 'Fn Step 1')],
    };
    const auto: Automation = { ...BASE_AUTOMATION, functions: [fn0] };
    const state = stateWith(auto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0], functionIndex: 0 },
    });
    // Duplicating functions[0].steps[0] → copy lands at steps[1]
    expect(next.selectedNodeId).toBe('function:0:step:1');
  });

  it('top-level steps are not affected when duplicating a function-body step', () => {
    const fn0: FunctionDefinition = {
      name: 'fn0',
      steps: [makeStep('fn0s0', 'Fn Step 0')],
    };
    const auto: Automation = { ...BASE_AUTOMATION, functions: [fn0] };
    const state = stateWith(auto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0], functionIndex: 0 },
    });
    expect(next.automation!.steps).toHaveLength(BASE_AUTOMATION.steps.length);
  });

  // --- function-body substeps (loop inside a function) ---

  it('duplicates a substep inside a loop inside a function body', () => {
    const innerSub0 = makeStep('is0', 'Inner 0');
    const innerSub1 = makeStep('is1', 'Inner 1');
    const fn0: FunctionDefinition = {
      name: 'fn0',
      steps: [makeLoopStep('fnLoop', [innerSub0, innerSub1])],
    };
    const auto: Automation = { ...BASE_AUTOMATION, functions: [fn0] };
    const state = stateWith(auto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0, 1], functionIndex: 0 },
    });
    const substeps = next.automation!.functions![0].steps[0].substeps!;
    expect(substeps).toHaveLength(3);
    expect(substeps[1].id).toBe(innerSub1.id);      // original at [0,1]
    expect(substeps[2].id).not.toBe(innerSub1.id);  // copy at [0,2]
    expect(substeps[2].name).toBe('Inner 1 (copy)');
  });

  it('selectedNodeId encodes function body substep position', () => {
    const fn0: FunctionDefinition = {
      name: 'fn0',
      steps: [makeLoopStep('fnLoop', [makeStep('is0'), makeStep('is1')])],
    };
    const auto: Automation = { ...BASE_AUTOMATION, functions: [fn0] };
    const state = stateWith(auto);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [0, 1], functionIndex: 0 },
    });
    // Copy lands at functions[0].steps[0].substeps[2] → function:0:step:0.2
    expect(next.selectedNodeId).toBe('function:0:step:0.2');
  });

  // --- out-of-bounds path ---

  it('returns the same state without crashing when path is out of bounds', () => {
    const state = stateWith(BASE_AUTOMATION);
    const next = editorReducer(state, {
      type: 'DUPLICATE_STEP',
      payload: { path: [99] },
    });
    // State is returned unchanged (no crash)
    expect(next.automation!.steps).toHaveLength(BASE_AUTOMATION.steps.length);
    expect(next.dirty).toBe(false); // unchanged from loaded state
  });
});
