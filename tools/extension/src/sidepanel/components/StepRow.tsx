import { useState } from 'react';
import type {
  Step,
  NavigateAction,
  InteractAction,
  WaitAction,
  ToolCallAction,
  Selectors,
} from '@portalflow/schema';

interface Props {
  step: Step;
  index: number;
  total: number;
  onUpdate: (changes: Partial<Step>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function StepRow({ step, index, total, onUpdate, onRemove, onMoveUp, onMoveDown }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="step-row">
      <div className="step-header">
        <span className="step-index">{index + 1}.</span>
        <span className="step-type-badge">{step.type}</span>
        <input
          className="step-name"
          type="text"
          value={step.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
        <div className="step-controls">
          <button
            className="btn-ghost"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
          >
            &uarr;
          </button>
          <button
            className="btn-ghost"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
          >
            &darr;
          </button>
          <button
            className="btn-ghost"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '\u25b2' : '\u25bc'}
          </button>
          <button className="btn-ghost btn-danger" onClick={onRemove} title="Delete">
            &times;
          </button>
        </div>
      </div>
      {expanded && <StepEditor step={step} onUpdate={onUpdate} />}
    </div>
  );
}

function StepEditor({
  step,
  onUpdate,
}: {
  step: Step;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  return (
    <div className="step-editor">
      {step.type === 'navigate' && (
        <NavigateEditor action={step.action as NavigateAction} onUpdate={onUpdate} />
      )}
      {step.type === 'interact' && (
        <InteractEditor action={step.action as InteractAction} onUpdate={onUpdate} />
      )}
      {step.type === 'wait' && (
        <WaitEditor action={step.action as WaitAction} onUpdate={onUpdate} />
      )}
      {step.type === 'tool_call' && (
        <ToolCallEditor action={step.action as ToolCallAction} onUpdate={onUpdate} />
      )}

      <SelectorsEditor step={step} onUpdate={onUpdate} />
      <AdvancedEditor step={step} onUpdate={onUpdate} />
    </div>
  );
}

function NavigateEditor({
  action,
  onUpdate,
}: {
  action: NavigateAction;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  return (
    <label className="field">
      <span>URL</span>
      <input
        type="text"
        value={action.url}
        onChange={(e) => onUpdate({ action: { ...action, url: e.target.value } })}
      />
    </label>
  );
}

function InteractEditor({
  action,
  onUpdate,
}: {
  action: InteractAction;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  const showValue =
    action.interaction === 'type' || action.interaction === 'select';

  return (
    <>
      <label className="field">
        <span>Interaction</span>
        <select
          value={action.interaction}
          onChange={(e) =>
            onUpdate({ action: { ...action, interaction: e.target.value as InteractAction['interaction'] } })
          }
        >
          {(['click', 'type', 'select', 'check', 'uncheck', 'hover', 'focus'] as const).map(
            (i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ),
          )}
        </select>
      </label>
      {showValue && (
        <>
          <label className="field">
            <span>Value</span>
            <input
              type="text"
              value={action.value ?? ''}
              onChange={(e) => onUpdate({ action: { ...action, value: e.target.value } })}
              placeholder="Literal value"
            />
          </label>
          <label className="field">
            <span>Input reference</span>
            <input
              type="text"
              value={action.inputRef ?? ''}
              onChange={(e) => onUpdate({ action: { ...action, inputRef: e.target.value } })}
              placeholder="Name of an input"
            />
          </label>
        </>
      )}
    </>
  );
}

function WaitEditor({
  action,
  onUpdate,
}: {
  action: WaitAction;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  return (
    <>
      <label className="field">
        <span>Condition</span>
        <select
          value={action.condition}
          onChange={(e) =>
            onUpdate({ action: { ...action, condition: e.target.value as WaitAction['condition'] } })
          }
        >
          {(['selector', 'navigation', 'delay', 'network_idle'] as const).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {action.condition !== 'network_idle' && (
        <label className="field">
          <span>Value</span>
          <input
            type="text"
            value={action.value ?? ''}
            onChange={(e) => onUpdate({ action: { ...action, value: e.target.value } })}
            placeholder={action.condition === 'delay' ? 'Milliseconds' : 'Selector or URL pattern'}
          />
        </label>
      )}
    </>
  );
}

function ToolCallEditor({
  action,
  onUpdate,
}: {
  action: ToolCallAction;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  return (
    <>
      <label className="field">
        <span>Tool</span>
        <select
          value={action.tool}
          onChange={(e) =>
            onUpdate({ action: { ...action, tool: e.target.value as ToolCallAction['tool'] } })
          }
        >
          <option value="smscli">smscli</option>
          <option value="vaultcli">vaultcli</option>
        </select>
      </label>
      <label className="field">
        <span>Command</span>
        <input
          type="text"
          value={action.command}
          onChange={(e) => onUpdate({ action: { ...action, command: e.target.value } })}
          placeholder="get-otp"
        />
      </label>
      <label className="field">
        <span>Output name</span>
        <input
          type="text"
          value={action.outputName ?? ''}
          onChange={(e) => onUpdate({ action: { ...action, outputName: e.target.value } })}
          placeholder="otpCode"
        />
      </label>
    </>
  );
}

function SelectorsEditor({
  step,
  onUpdate,
}: {
  step: Step;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  if (
    step.type === 'navigate' ||
    step.type === 'wait' ||
    step.type === 'tool_call' ||
    step.type === 'condition'
  ) {
    return null;
  }

  const selectors: Selectors = step.selectors ?? { primary: '' };

  return (
    <>
      <label className="field">
        <span>Primary selector</span>
        <input
          type="text"
          value={selectors.primary}
          onChange={(e) =>
            onUpdate({
              selectors: { ...selectors, primary: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>AI guidance</span>
        <textarea
          value={step.aiGuidance ?? ''}
          onChange={(e) => onUpdate({ aiGuidance: e.target.value })}
          rows={2}
          placeholder="Natural-language hint for when selectors break"
        />
      </label>
    </>
  );
}

function AdvancedEditor({
  step,
  onUpdate,
}: {
  step: Step;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  return (
    <div className="advanced-row">
      <label className="field field-inline">
        <span>On failure</span>
        <select
          value={step.onFailure}
          onChange={(e) => onUpdate({ onFailure: e.target.value as Step['onFailure'] })}
        >
          <option value="abort">abort</option>
          <option value="retry">retry</option>
          <option value="skip">skip</option>
        </select>
      </label>
      <label className="field field-inline">
        <span>Max retries</span>
        <input
          type="number"
          value={step.maxRetries}
          min={0}
          onChange={(e) => onUpdate({ maxRetries: Number(e.target.value) })}
        />
      </label>
      <label className="field field-inline">
        <span>Timeout (ms)</span>
        <input
          type="number"
          value={step.timeout}
          min={0}
          onChange={(e) => onUpdate({ timeout: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
