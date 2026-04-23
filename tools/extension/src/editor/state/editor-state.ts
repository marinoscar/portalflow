import { z } from 'zod';
import { AutomationSchema } from '@portalflow/schema';
import type { Automation, Input, Step, FunctionDefinition } from '@portalflow/schema';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type ValidationResult = z.SafeParseReturnType<unknown, Automation>;

export interface EditorState {
  automation: Automation | null;
  selectedNodeId: string | null;
  validation: ValidationResult;
  dirty: boolean;
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type EditorAction =
  | { type: 'LOAD'; payload: Automation }
  | { type: 'RESET' }
  | { type: 'SELECT_NODE'; payload: string | null }
  | { type: 'MARK_CLEAN' }
  | { type: 'UPDATE_METADATA'; payload: Partial<Pick<Automation, 'name' | 'description' | 'goal' | 'version'>> }
  | { type: 'UPDATE_INPUT'; payload: { index: number; changes: Partial<Input> } }
  | { type: 'ADD_INPUT'; payload: Input }
  | { type: 'REMOVE_INPUT'; payload: { index: number } }
  | { type: 'UPDATE_STEP'; payload: { path: number[]; changes: Partial<Step> } }
  | { type: 'INSERT_STEP'; payload: { path: number[]; step: Step; position: 'before' | 'after' | 'append-substep' } }
  | { type: 'MOVE_STEP'; payload: { path: number[]; direction: 'up' | 'down' } }
  | { type: 'REMOVE_STEP'; payload: { path: number[] } }
  | { type: 'UPDATE_FUNCTION'; payload: { index: number; changes: Partial<FunctionDefinition> } }
  | { type: 'ADD_FUNCTION'; payload: FunctionDefinition }
  | { type: 'REMOVE_FUNCTION'; payload: { index: number } };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function revalidate(automation: Automation | null): ValidationResult {
  if (automation === null) {
    // Return a synthetic failure result when there's nothing to validate
    return { success: false, error: new z.ZodError([]) };
  }
  return AutomationSchema.safeParse(automation);
}

/**
 * Returns a shallow clone of the steps array with the step at `path`
 * replaced by the result of `fn`. Recurses into `substeps` for deeper paths.
 */
function mapStepAtPath(
  steps: Step[],
  path: number[],
  fn: (step: Step) => Step,
): Step[] {
  const [head, ...tail] = path;
  return steps.map((step, idx) => {
    if (idx !== head) return step;
    if (tail.length === 0) return fn(step);
    // Recurse into substeps
    return {
      ...step,
      substeps: mapStepAtPath(step.substeps ?? [], tail, fn),
    };
  });
}

/**
 * Returns a shallow clone of the steps array with the step at `path` removed.
 */
function removeStepAtPath(steps: Step[], path: number[]): Step[] {
  const [head, ...tail] = path;
  if (tail.length === 0) {
    return steps.filter((_, idx) => idx !== head);
  }
  return steps.map((step, idx) => {
    if (idx !== head) return step;
    return {
      ...step,
      substeps: removeStepAtPath(step.substeps ?? [], tail),
    };
  });
}

/**
 * Returns a shallow clone of the steps array with the step at `path`
 * inserted before or after the target position.
 */
function insertStepAtPath(
  steps: Step[],
  path: number[],
  step: Step,
  position: 'before' | 'after' | 'append-substep',
): Step[] {
  const [head, ...tail] = path;

  if (tail.length === 0) {
    if (position === 'append-substep') {
      // Append into the head step's substeps
      return steps.map((s, idx) => {
        if (idx !== head) return s;
        return { ...s, substeps: [...(s.substeps ?? []), step] };
      });
    }
    const insertAt = position === 'before' ? head : head + 1;
    const result = [...steps];
    result.splice(insertAt, 0, step);
    return result;
  }

  return steps.map((s, idx) => {
    if (idx !== head) return s;
    return {
      ...s,
      substeps: insertStepAtPath(s.substeps ?? [], tail, step, position),
    };
  });
}

/**
 * Returns a shallow clone of the steps array with the step at `path`
 * swapped with its neighbor (direction: 'up' or 'down').
 */
function moveStepAtPath(steps: Step[], path: number[], direction: 'up' | 'down'): Step[] {
  const [head, ...tail] = path;

  if (tail.length === 0) {
    const target = direction === 'up' ? head - 1 : head + 1;
    if (target < 0 || target >= steps.length) return steps; // bounds-safe
    const result = [...steps];
    [result[head], result[target]] = [result[target], result[head]];
    return result;
  }

  return steps.map((step, idx) => {
    if (idx !== head) return step;
    return {
      ...step,
      substeps: moveStepAtPath(step.substeps ?? [], tail, direction),
    };
  });
}

// ---------------------------------------------------------------------------
// Empty automation factory
// ---------------------------------------------------------------------------

export function newEmptyAutomation(): Automation {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled automation',
    version: '1.0.0',
    description: '',
    goal: '',
    inputs: [],
    steps: [],
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: EditorState = {
  automation: null,
  selectedNodeId: null,
  validation: { success: false, error: new z.ZodError([]) },
  dirty: false,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'LOAD': {
      const automation = action.payload;
      return {
        automation,
        selectedNodeId: 'metadata',
        validation: revalidate(automation),
        dirty: false,
      };
    }

    case 'RESET': {
      return { ...initialState };
    }

    case 'SELECT_NODE': {
      return { ...state, selectedNodeId: action.payload };
    }

    case 'MARK_CLEAN': {
      return { ...state, dirty: false };
    }

    case 'UPDATE_METADATA': {
      if (!state.automation) return state;
      const automation: Automation = { ...state.automation, ...action.payload };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'UPDATE_INPUT': {
      if (!state.automation) return state;
      const inputs = state.automation.inputs.map((inp, idx) =>
        idx === action.payload.index ? { ...inp, ...action.payload.changes } : inp,
      );
      const automation: Automation = { ...state.automation, inputs };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'ADD_INPUT': {
      if (!state.automation) return state;
      const inputs = [...state.automation.inputs, action.payload];
      const automation: Automation = { ...state.automation, inputs };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'REMOVE_INPUT': {
      if (!state.automation) return state;
      const inputs = state.automation.inputs.filter((_, idx) => idx !== action.payload.index);
      const automation: Automation = { ...state.automation, inputs };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'UPDATE_STEP': {
      if (!state.automation) return state;
      const steps = mapStepAtPath(
        state.automation.steps,
        action.payload.path,
        (step) => ({ ...step, ...action.payload.changes }),
      );
      const automation: Automation = { ...state.automation, steps };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'INSERT_STEP': {
      if (!state.automation) return state;
      const steps = insertStepAtPath(
        state.automation.steps,
        action.payload.path,
        action.payload.step,
        action.payload.position,
      );
      const automation: Automation = { ...state.automation, steps };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'MOVE_STEP': {
      if (!state.automation) return state;
      const steps = moveStepAtPath(
        state.automation.steps,
        action.payload.path,
        action.payload.direction,
      );
      const automation: Automation = { ...state.automation, steps };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'REMOVE_STEP': {
      if (!state.automation) return state;
      const steps = removeStepAtPath(state.automation.steps, action.payload.path);
      const automation: Automation = { ...state.automation, steps };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'UPDATE_FUNCTION': {
      if (!state.automation) return state;
      const functions = (state.automation.functions ?? []).map((fn, idx) =>
        idx === action.payload.index ? { ...fn, ...action.payload.changes } : fn,
      );
      const automation: Automation = { ...state.automation, functions };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'ADD_FUNCTION': {
      if (!state.automation) return state;
      const functions = [...(state.automation.functions ?? []), action.payload];
      const automation: Automation = { ...state.automation, functions };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    case 'REMOVE_FUNCTION': {
      if (!state.automation) return state;
      const functions = (state.automation.functions ?? []).filter(
        (_, idx) => idx !== action.payload.index,
      );
      const automation: Automation = { ...state.automation, functions };
      return { ...state, automation, validation: revalidate(automation), dirty: true };
    }

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
