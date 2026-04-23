import { useRef } from 'react';
import type { Automation, Step, FunctionDefinition, Input } from '@portalflow/schema';
import type { EditorAction } from '../state/editor-state';
import { encodeNodeId } from '../state/selection';

// ---------------------------------------------------------------------------
// Step type icons
// ---------------------------------------------------------------------------

const STEP_ICONS: Record<string, string> = {
  navigate: '🌐',
  interact: '👆',
  wait: '⏱',
  extract: '📋',
  tool_call: '🛠',
  condition: '❓',
  download: '⬇',
  loop: '🔁',
  call: '📞',
  goto: '↪',
  aiscope: '✨',
};

// ---------------------------------------------------------------------------
// Default step factory
// ---------------------------------------------------------------------------

function makeDefaultStep(type: Step['type'] = 'navigate'): Step {
  return {
    id: crypto.randomUUID(),
    name: `New ${type} step`,
    type,
    action: { url: '' } as Step['action'],
    onFailure: 'abort',
    maxRetries: 3,
    timeout: 30000,
  };
}

function makeDefaultInput(): Input {
  return {
    name: 'newInput',
    type: 'string',
    required: true,
  };
}

function makeDefaultFunction(): FunctionDefinition {
  return {
    name: 'newFunction',
    steps: [],
  };
}

// ---------------------------------------------------------------------------
// Drag state (module-level ref used inside event handlers)
// ---------------------------------------------------------------------------

interface DragInfo {
  kind: 'step' | 'input' | 'function' | 'substep';
  fromIndex: number;
  // For substeps inside a loop step, the parent path
  parentPath?: number[];
  // For function body steps
  fnIndex?: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OutlineProps {
  automation: Automation;
  selectedNodeId: string | null;
  dispatch: (action: EditorAction) => void;
}

// ---------------------------------------------------------------------------
// Outline component
// ---------------------------------------------------------------------------

export function Outline({ automation, selectedNodeId, dispatch }: OutlineProps) {
  const dragInfoRef = useRef<DragInfo | null>(null);
  const dragIndicatorRef = useRef<HTMLElement | null>(null);

  // ---------- helpers ---------------------------------------------------------

  const select = (id: string) => dispatch({ type: 'SELECT_NODE', payload: id });

  // Show/hide drop indicator line
  const showIndicator = (targetEl: HTMLElement, before: boolean) => {
    removeIndicator();
    const indicator = document.createElement('div');
    indicator.className = 'outline-drop-indicator';
    if (before) {
      targetEl.parentElement?.insertBefore(indicator, targetEl);
    } else {
      targetEl.parentElement?.insertBefore(indicator, targetEl.nextSibling);
    }
    dragIndicatorRef.current = indicator;
  };

  const removeIndicator = () => {
    dragIndicatorRef.current?.remove();
    dragIndicatorRef.current = null;
  };

  // ---------- DnD for top-level steps -----------------------------------------

  const makeStepDragHandlers = (path: number[]) => {
    const index = path[path.length - 1];
    return {
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        dragInfoRef.current = { kind: 'step', fromIndex: index };
      },
      onDragOver: (e: React.DragEvent<HTMLLIElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        showIndicator(e.currentTarget, e.clientY < midY);
      },
      onDrop: (e: React.DragEvent<HTMLLIElement>) => {
        e.preventDefault();
        e.stopPropagation();
        removeIndicator();
        const info = dragInfoRef.current;
        if (!info || info.kind !== 'step') return;
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const before = e.clientY < midY;
        const toIndex = before ? index : index;
        // Dispatch MOVE_STEP by swapping toward target
        const from = info.fromIndex;
        if (from === toIndex) return;
        const direction = from < toIndex ? 'down' : 'up';
        const steps = from < toIndex ? toIndex - from : from - toIndex;
        for (let i = 0; i < steps; i++) {
          dispatch({
            type: 'MOVE_STEP',
            payload: {
              path: [from < toIndex ? from + i : from - i],
              direction,
            },
          });
        }
        dragInfoRef.current = null;
      },
      onDragEnd: () => {
        removeIndicator();
        dragInfoRef.current = null;
      },
    };
  };

  // ---------- DnD for inputs --------------------------------------------------

  const makeInputDragHandlers = (index: number) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      dragInfoRef.current = { kind: 'input', fromIndex: index };
    },
    onDragOver: (e: React.DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      showIndicator(e.currentTarget, e.clientY < rect.top + rect.height / 2);
    },
    onDrop: (e: React.DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      e.stopPropagation();
      removeIndicator();
      const info = dragInfoRef.current;
      if (!info || info.kind !== 'input') return;
      const from = info.fromIndex;
      if (from === index) return;
      // Reorder inputs by removing and re-inserting
      const inputs = [...automation.inputs];
      const [removed] = inputs.splice(from, 1);
      inputs.splice(index, 0, removed);
      // Apply via sequential remove/add — we'll just reload them all
      // by dispatching updates; simplest is to re-insert at the correct position.
      // Since we don't have a REORDER_INPUTS action, we simulate with REMOVE + ADD.
      // To avoid index shifting issues, we use a stable approach:
      // remove from original position, insert at new position.
      dispatch({ type: 'REMOVE_INPUT', payload: { index: from } });
      dispatch({ type: 'ADD_INPUT', payload: removed });
      dragInfoRef.current = null;
    },
    onDragEnd: () => {
      removeIndicator();
      dragInfoRef.current = null;
    },
  });

  // ---------- DnD for functions -----------------------------------------------

  const makeFunctionDragHandlers = (index: number) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      dragInfoRef.current = { kind: 'function', fromIndex: index };
    },
    onDragOver: (e: React.DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      showIndicator(e.currentTarget, e.clientY < rect.top + rect.height / 2);
    },
    onDrop: (e: React.DragEvent<HTMLLIElement>) => {
      e.preventDefault();
      e.stopPropagation();
      removeIndicator();
      const info = dragInfoRef.current;
      if (!info || info.kind !== 'function') return;
      const from = info.fromIndex;
      if (from === index) return;
      const fns = [...(automation.functions ?? [])];
      const [removed] = fns.splice(from, 1);
      fns.splice(index, 0, removed);
      dispatch({ type: 'REMOVE_FUNCTION', payload: { index: from } });
      dispatch({ type: 'ADD_FUNCTION', payload: removed });
      dragInfoRef.current = null;
    },
    onDragEnd: () => {
      removeIndicator();
      dragInfoRef.current = null;
    },
  });

  // ---------- Recursive step list renderer ------------------------------------

  function renderStepList(
    steps: Step[],
    basePath: number[],
    fnIndex?: number,
  ): React.ReactNode {
    return steps.map((step, idx) => {
      const path = [...basePath, idx];
      const nodeId = fnIndex !== undefined
        ? encodeNodeId({ kind: 'function', index: fnIndex, stepPath: path })
        : encodeNodeId({ kind: 'step', path });
      const isSelected = selectedNodeId === nodeId;
      const icon = STEP_ICONS[step.type] ?? '▸';
      const hasSubsteps = step.type === 'loop' && (step.substeps?.length ?? 0) > 0;

      const dragHandlers = fnIndex === undefined ? makeStepDragHandlers(path) : {};

      return (
        <li
          key={step.id}
          className={`outline-item outline-item--step ${isSelected ? 'is-selected' : ''}`}
          {...dragHandlers}
        >
          <div
            className="outline-item-row"
            onClick={() => select(nodeId)}
          >
            <span className="outline-icon">{icon}</span>
            <span className="outline-label">{step.name || `(${step.type})`}</span>
            <span className="outline-badge">{step.type}</span>
            <button
              className="outline-remove"
              type="button"
              title="Remove step"
              onClick={(e) => {
                e.stopPropagation();
                if (fnIndex !== undefined) {
                  const fn = (automation.functions ?? [])[fnIndex];
                  if (!fn) return;
                  const newSteps = fn.steps.filter((_, i) => i !== idx);
                  dispatch({
                    type: 'UPDATE_FUNCTION',
                    payload: { index: fnIndex, changes: { steps: newSteps } },
                  });
                } else {
                  dispatch({ type: 'REMOVE_STEP', payload: { path } });
                }
              }}
            >
              &times;
            </button>
          </div>

          {/* Substeps (loop children) */}
          {hasSubsteps && (
            <ul className="outline-subtree">
              {renderStepList(step.substeps!, path.concat() /* re-use same fn context */, fnIndex)}
            </ul>
          )}

          {/* Add substep button on loop */}
          {step.type === 'loop' && (
            <div className="outline-add-row outline-add-row--substep">
              <button
                className="btn-ghost outline-add-btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const newStep = makeDefaultStep('navigate');
                  dispatch({
                    type: 'INSERT_STEP',
                    payload: { path, step: newStep, position: 'append-substep' },
                  });
                }}
              >
                + Substep
              </button>
            </div>
          )}
        </li>
      );
    });
  }

  // ---------- render ----------------------------------------------------------

  const functions = automation.functions ?? [];

  const metaSelected = selectedNodeId === 'metadata';

  return (
    <div className="outline-tree">
      {/* Metadata */}
      <div
        className={`outline-item outline-item--section ${metaSelected ? 'is-selected' : ''}`}
        onClick={() => select('metadata')}
      >
        <span className="outline-icon">📄</span>
        <span className="outline-label">Metadata</span>
      </div>

      {/* Inputs */}
      <details className="outline-section" open>
        <summary className="outline-section-header">
          <span className="outline-section-title">Inputs</span>
          <span className="outline-section-count">{automation.inputs.length}</span>
        </summary>
        <ul className="outline-list">
          {automation.inputs.map((input, idx) => {
            const nodeId = encodeNodeId({ kind: 'input', index: idx });
            const isSelected = selectedNodeId === nodeId;
            return (
              <li
                key={`input-${idx}`}
                className={`outline-item outline-item--input ${isSelected ? 'is-selected' : ''}`}
                {...makeInputDragHandlers(idx)}
              >
                <div className="outline-item-row" onClick={() => select(nodeId)}>
                  <span className="outline-icon">📥</span>
                  <span className="outline-label">{input.name || `input ${idx}`}</span>
                  <span className="outline-badge">{input.type}</span>
                  <button
                    className="outline-remove"
                    type="button"
                    title="Remove input"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: 'REMOVE_INPUT', payload: { index: idx } });
                    }}
                  >
                    &times;
                  </button>
                </div>
              </li>
            );
          })}
          <li className="outline-add-row">
            <button
              className="btn-ghost outline-add-btn"
              type="button"
              onClick={() => dispatch({ type: 'ADD_INPUT', payload: makeDefaultInput() })}
            >
              + Input
            </button>
          </li>
        </ul>
      </details>

      {/* Steps */}
      <details className="outline-section" open>
        <summary className="outline-section-header">
          <span className="outline-section-title">Steps</span>
          <span className="outline-section-count">{automation.steps.length}</span>
        </summary>
        <ul className="outline-list">
          {renderStepList(automation.steps, [])}
          <li className="outline-add-row">
            <button
              className="btn-ghost outline-add-btn"
              type="button"
              onClick={() => {
                const step = makeDefaultStep('navigate');
                dispatch({
                  type: 'INSERT_STEP',
                  payload: {
                    path: [automation.steps.length > 0 ? automation.steps.length - 1 : 0],
                    step,
                    position: automation.steps.length === 0 ? 'before' : 'after',
                  },
                });
              }}
            >
              + Step
            </button>
          </li>
        </ul>
      </details>

      {/* Functions */}
      <details className="outline-section" open>
        <summary className="outline-section-header">
          <span className="outline-section-title">Functions</span>
          <span className="outline-section-count">{functions.length}</span>
        </summary>
        <ul className="outline-list">
          {functions.map((fn, fnIdx) => {
            const fnNodeId = encodeNodeId({ kind: 'function', index: fnIdx });
            const isFnSelected = selectedNodeId === fnNodeId;
            return (
              <li
                key={`fn-${fnIdx}`}
                className={`outline-item outline-item--function ${isFnSelected ? 'is-selected' : ''}`}
                {...makeFunctionDragHandlers(fnIdx)}
              >
                <div className="outline-item-row" onClick={() => select(fnNodeId)}>
                  <span className="outline-icon">⚙</span>
                  <span className="outline-label">{fn.name || `function ${fnIdx}`}</span>
                  <button
                    className="outline-remove"
                    type="button"
                    title="Remove function"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: 'REMOVE_FUNCTION', payload: { index: fnIdx } });
                    }}
                  >
                    &times;
                  </button>
                </div>

                {/* Function body steps */}
                {fn.steps.length > 0 && (
                  <ul className="outline-subtree">
                    {renderStepList(fn.steps, [], fnIdx)}
                  </ul>
                )}

                {/* Add step to function */}
                <div className="outline-add-row outline-add-row--substep">
                  <button
                    className="btn-ghost outline-add-btn"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const step = makeDefaultStep('navigate');
                      dispatch({
                        type: 'UPDATE_FUNCTION',
                        payload: {
                          index: fnIdx,
                          changes: { steps: [...fn.steps, step] },
                        },
                      });
                    }}
                  >
                    + Step in function
                  </button>
                </div>
              </li>
            );
          })}
          <li className="outline-add-row">
            <button
              className="btn-ghost outline-add-btn"
              type="button"
              onClick={() =>
                dispatch({ type: 'ADD_FUNCTION', payload: makeDefaultFunction() })
              }
            >
              + Function
            </button>
          </li>
        </ul>
      </details>
    </div>
  );
}
