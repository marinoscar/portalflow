import type { Automation, Input, Step } from '@portalflow/schema';

export type AutomationState = {
  automation: Automation | null;
};

export type AutomationAction =
  | { type: 'SET_AUTOMATION'; automation: Automation }
  | { type: 'CLEAR_AUTOMATION' }
  | { type: 'UPDATE_METADATA'; changes: Partial<Pick<Automation, 'name' | 'goal' | 'description' | 'version'>> }
  | { type: 'ADD_INPUT'; input: Input }
  | { type: 'UPDATE_INPUT'; index: number; changes: Partial<Input> }
  | { type: 'REMOVE_INPUT'; index: number }
  | { type: 'UPDATE_STEP'; index: number; changes: Partial<Step> }
  | { type: 'MOVE_STEP'; from: number; to: number }
  | { type: 'REMOVE_STEP'; index: number }
  | { type: 'ADD_STEP'; step: Step };

export function automationReducer(
  state: AutomationState,
  action: AutomationAction,
): AutomationState {
  const a = state.automation;

  switch (action.type) {
    case 'SET_AUTOMATION':
      return { automation: action.automation };
    case 'CLEAR_AUTOMATION':
      return { automation: null };
    case 'UPDATE_METADATA':
      if (!a) return state;
      return { automation: { ...a, ...action.changes } };
    case 'ADD_INPUT':
      if (!a) return state;
      return { automation: { ...a, inputs: [...a.inputs, action.input] } };
    case 'UPDATE_INPUT':
      if (!a) return state;
      return {
        automation: {
          ...a,
          inputs: a.inputs.map((inp, i) =>
            i === action.index ? { ...inp, ...action.changes } : inp,
          ),
        },
      };
    case 'REMOVE_INPUT':
      if (!a) return state;
      return { automation: { ...a, inputs: a.inputs.filter((_, i) => i !== action.index) } };
    case 'UPDATE_STEP':
      if (!a) return state;
      return {
        automation: {
          ...a,
          steps: a.steps.map((s, i) =>
            i === action.index ? { ...s, ...action.changes } : s,
          ),
        },
      };
    case 'MOVE_STEP': {
      if (!a) return state;
      const steps = [...a.steps];
      const [moved] = steps.splice(action.from, 1);
      if (moved) steps.splice(action.to, 0, moved);
      // Renumber
      steps.forEach((s, idx) => {
        s.id = `step-${idx + 1}`;
      });
      return { automation: { ...a, steps } };
    }
    case 'REMOVE_STEP': {
      if (!a) return state;
      const steps = a.steps.filter((_, i) => i !== action.index);
      steps.forEach((s, idx) => {
        s.id = `step-${idx + 1}`;
      });
      return { automation: { ...a, steps } };
    }
    case 'ADD_STEP': {
      if (!a) return state;
      const steps = [...a.steps, action.step];
      steps.forEach((s, idx) => {
        s.id = `step-${idx + 1}`;
      });
      return { automation: { ...a, steps } };
    }
  }
}
