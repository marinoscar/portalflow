import type { Automation, Input, Step } from '@portalflow/schema';
import type {
  AutomationVersion,
  ChatMessage,
  VersionAuthor,
} from '../../shared/types';

/**
 * Maximum number of committed versions retained per session. When the
 * cap is exceeded, the OLDEST non-pinned version is dropped. Index 0
 * (the raw-recording version) is pinned and never pruned.
 */
export const VERSION_CAP = 100;

function newVersionId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type AutomationState = {
  automation: Automation | null;
  versions: AutomationVersion[];
  currentVersionId: string | null;
  chatHistory: ChatMessage[];
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
  | { type: 'ADD_STEP'; step: Step }
  | { type: 'INSERT_STEP'; index: number; step: Step }
  | { type: 'REPLACE_STEPS'; steps: Step[] }
  | { type: 'HYDRATE_VERSIONS'; versions: AutomationVersion[]; currentVersionId: string | null }
  | { type: 'COMMIT_VERSION'; author: VersionAuthor; message: string }
  | { type: 'CHECKOUT_VERSION'; versionId: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'HYDRATE_CHAT'; chatHistory: ChatMessage[] }
  | { type: 'APPEND_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'UPDATE_PROPOSAL_STATUS'; messageId: string; status: 'approved' | 'rejected' }
  | { type: 'CLEAR_CHAT' };

/** Default empty state used by useReducer. */
export const initialAutomationState: AutomationState = {
  automation: null,
  versions: [],
  currentVersionId: null,
  chatHistory: [],
};

/** Returns a new AutomationState that preserves versioning fields. */
function withAutomation(
  state: AutomationState,
  automation: Automation,
): AutomationState {
  return { ...state, automation };
}

/**
 * Deep-clone with structuredClone so committed versions are isolated from
 * later mutations of the working automation. Fallback to JSON clone if
 * structuredClone is not available (older test environments).
 */
function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Appends a new version to the history. Prunes the oldest non-pinned
 * version if the cap is exceeded. Pinned = version at index 0 with
 * author 'raw-recording'.
 */
function commitVersion(
  state: AutomationState,
  author: VersionAuthor,
  message: string,
): AutomationState {
  if (!state.automation) return state;

  const entry: AutomationVersion = {
    id: newVersionId(),
    createdAt: Date.now(),
    author,
    message,
    automation: clone(state.automation),
  };

  let versions = [...state.versions, entry];

  // Prune oldest non-pinned version if we're past the cap.
  if (versions.length > VERSION_CAP) {
    const pinned = versions[0]; // always the raw-recording version if present
    const rest = versions.slice(1);
    while (1 + rest.length > VERSION_CAP && rest.length > 0) {
      rest.shift();
    }
    versions = [pinned, ...rest];
  }

  return {
    ...state,
    versions,
    currentVersionId: entry.id,
  };
}

export function automationReducer(
  state: AutomationState,
  action: AutomationAction,
): AutomationState {
  const a = state.automation;

  switch (action.type) {
    case 'SET_AUTOMATION':
      return withAutomation(state, action.automation);
    case 'CLEAR_AUTOMATION':
      return { ...state, automation: null };
    case 'UPDATE_METADATA':
      if (!a) return state;
      return withAutomation(state, { ...a, ...action.changes });
    case 'ADD_INPUT':
      if (!a) return state;
      return withAutomation(state, { ...a, inputs: [...a.inputs, action.input] });
    case 'UPDATE_INPUT':
      if (!a) return state;
      return withAutomation(state, {
        ...a,
        inputs: a.inputs.map((inp, i) =>
          i === action.index ? { ...inp, ...action.changes } : inp,
        ),
      });
    case 'REMOVE_INPUT':
      if (!a) return state;
      return withAutomation(state, {
        ...a,
        inputs: a.inputs.filter((_, i) => i !== action.index),
      });
    case 'UPDATE_STEP':
      if (!a) return state;
      return withAutomation(state, {
        ...a,
        steps: a.steps.map((s, i) =>
          i === action.index ? { ...s, ...action.changes } : s,
        ),
      });
    case 'MOVE_STEP': {
      if (!a) return state;
      const steps = [...a.steps];
      const [moved] = steps.splice(action.from, 1);
      if (moved) steps.splice(action.to, 0, moved);
      steps.forEach((s, idx) => {
        s.id = `step-${idx + 1}`;
      });
      return withAutomation(state, { ...a, steps });
    }
    case 'REMOVE_STEP': {
      if (!a) return state;
      const steps = a.steps.filter((_, i) => i !== action.index);
      steps.forEach((s, idx) => {
        s.id = `step-${idx + 1}`;
      });
      return withAutomation(state, { ...a, steps });
    }
    case 'ADD_STEP': {
      if (!a) return state;
      const steps = [...a.steps, action.step];
      steps.forEach((s, idx) => {
        s.id = `step-${idx + 1}`;
      });
      return withAutomation(state, { ...a, steps });
    }
    case 'INSERT_STEP': {
      if (!a) return state;
      const steps = [...a.steps];
      steps.splice(action.index, 0, action.step);
      steps.forEach((s, idx) => {
        s.id = `step-${idx + 1}`;
      });
      return withAutomation(state, { ...a, steps });
    }
    case 'REPLACE_STEPS': {
      if (!a) return state;
      const steps = action.steps.map((s, idx) => ({ ...s, id: `step-${idx + 1}` }));
      return withAutomation(state, { ...a, steps });
    }

    // ----- versioning actions -----

    case 'HYDRATE_VERSIONS':
      return {
        ...state,
        versions: action.versions,
        currentVersionId: action.currentVersionId,
      };

    case 'COMMIT_VERSION':
      return commitVersion(state, action.author, action.message);

    case 'CHECKOUT_VERSION': {
      const target = state.versions.find((v) => v.id === action.versionId);
      if (!target) return state;
      return {
        ...state,
        automation: clone(target.automation),
        currentVersionId: target.id,
      };
    }

    case 'UNDO': {
      const idx = state.versions.findIndex((v) => v.id === state.currentVersionId);
      if (idx <= 0) return state; // already at oldest or nothing to undo
      const prev = state.versions[idx - 1];
      return {
        ...state,
        automation: clone(prev.automation),
        currentVersionId: prev.id,
      };
    }

    case 'REDO': {
      const idx = state.versions.findIndex((v) => v.id === state.currentVersionId);
      if (idx < 0 || idx >= state.versions.length - 1) return state;
      const next = state.versions[idx + 1];
      return {
        ...state,
        automation: clone(next.automation),
        currentVersionId: next.id,
      };
    }

    // ----- chat actions -----

    case 'HYDRATE_CHAT':
      return { ...state, chatHistory: action.chatHistory };

    case 'APPEND_CHAT_MESSAGE':
      return { ...state, chatHistory: [...state.chatHistory, action.message] };

    case 'UPDATE_PROPOSAL_STATUS':
      return {
        ...state,
        chatHistory: state.chatHistory.map((m) =>
          m.id === action.messageId && m.proposal
            ? { ...m, proposal: { ...m.proposal, status: action.status } }
            : m,
        ),
      };

    case 'CLEAR_CHAT':
      return { ...state, chatHistory: [] };
  }
}
