import React from 'react';
import type { ConditionAction, Automation } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';
import { TextAreaField } from '../fields/TextAreaField';
import { TemplateHint } from '../fields/TemplateHint';

interface ConditionBodyProps {
  action: ConditionAction;
  onChange: (next: Partial<ConditionAction>) => void;
  errors: Record<string, string>;
  automation: Automation;
}

const CHECK_OPTIONS = [
  { value: 'element_exists', label: 'Element exists' },
  { value: 'url_matches', label: 'URL matches' },
  { value: 'text_contains', label: 'Text contains' },
  { value: 'variable_equals', label: 'Variable equals' },
];

function valuePlaceholderForCheck(check: ConditionAction['check']): string {
  switch (check) {
    case 'element_exists':
      return 'CSS selector';
    case 'url_matches':
      return 'URL substring';
    case 'text_contains':
      return 'Text to find';
    case 'variable_equals':
      return 'format: varName=expectedValue (no spaces around =)';
    default:
      return '';
  }
}

type Mode = 'deterministic' | 'ai';
type BranchMode = 'none' | 'jump' | 'call';

export function ConditionBody({ action, onChange, errors, automation }: ConditionBodyProps) {
  // Determine current mode
  const mode: Mode = action.ai !== undefined ? 'ai' : 'deterministic';

  // Determine branch modes
  const thenBranchMode: BranchMode = action.thenStep
    ? 'jump'
    : action.thenCall
      ? 'call'
      : 'none';
  const elseBranchMode: BranchMode = action.elseStep
    ? 'jump'
    : action.elseCall
      ? 'call'
      : 'none';

  const stepOptions = automation.steps.map((s) => ({ value: s.id, label: s.name || s.id }));
  const functionOptions = (automation.functions ?? []).map((f) => ({
    value: f.name,
    label: f.name,
  }));

  const hasSteps = stepOptions.length > 0;
  const hasFunctions = functionOptions.length > 0;

  function handleModeChange(newMode: Mode) {
    if (newMode === mode) return;
    if (newMode === 'ai') {
      // Switch to AI: clear deterministic fields
      onChange({ check: undefined, value: undefined, ai: '' });
    } else {
      // Switch to deterministic: clear AI field
      onChange({ ai: undefined, check: 'element_exists', value: '' });
    }
  }

  function handleThenBranchMode(newMode: BranchMode) {
    if (newMode === 'none') {
      onChange({ thenStep: undefined, thenCall: undefined });
    } else if (newMode === 'jump') {
      onChange({ thenStep: stepOptions[0]?.value ?? '', thenCall: undefined });
    } else {
      onChange({ thenCall: functionOptions[0]?.value ?? '', thenStep: undefined });
    }
  }

  function handleElseBranchMode(newMode: BranchMode) {
    if (newMode === 'none') {
      onChange({ elseStep: undefined, elseCall: undefined });
    } else if (newMode === 'jump') {
      onChange({ elseStep: stepOptions[0]?.value ?? '', elseCall: undefined });
    } else {
      onChange({ elseCall: functionOptions[0]?.value ?? '', elseStep: undefined });
    }
  }

  return (
    <div>
      {/* Mode selector */}
      <div className="field">
        <span>Condition mode</span>
        <div className="radio-row">
          <label className="radio-label">
            <input
              type="radio"
              name="condition-mode"
              checked={mode === 'deterministic'}
              onChange={() => handleModeChange('deterministic')}
            />
            Deterministic check
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="condition-mode"
              checked={mode === 'ai'}
              onChange={() => handleModeChange('ai')}
            />
            AI question
          </label>
        </div>
      </div>

      {/* Deterministic fields */}
      {mode === 'deterministic' && (
        <>
          <SelectField
            label="Check"
            value={action.check ?? 'element_exists'}
            onChange={(check) =>
              onChange({ check: check as NonNullable<ConditionAction['check']> })
            }
            options={CHECK_OPTIONS}
            required
            error={errors['check']}
          />
          <TextField
            label="Value"
            value={action.value ?? ''}
            onChange={(value) => onChange({ value })}
            placeholder={valuePlaceholderForCheck(action.check)}
            required
            error={errors['value']}
          />
          <TemplateHint />
        </>
      )}

      {/* AI fields */}
      {mode === 'ai' && (
        <>
          <TextAreaField
            label="AI question"
            value={action.ai ?? ''}
            onChange={(ai) => onChange({ ai })}
            placeholder="Is the payment confirmation page visible?"
            required
            error={errors['ai']}
          />
          <TemplateHint />
        </>
      )}

      {/* Branching — Then */}
      <div className="field">
        <span>Then (if true)</span>
        <div className="radio-row">
          <label className="radio-label">
            <input
              type="radio"
              name="then-branch"
              checked={thenBranchMode === 'none'}
              onChange={() => handleThenBranchMode('none')}
            />
            No branch
          </label>
          <label className={`radio-label${!hasSteps ? ' radio-label--disabled' : ''}`}>
            <input
              type="radio"
              name="then-branch"
              checked={thenBranchMode === 'jump'}
              onChange={() => handleThenBranchMode('jump')}
              disabled={!hasSteps}
            />
            Jump to step
          </label>
          <label className={`radio-label${!hasFunctions ? ' radio-label--disabled' : ''}`}>
            <input
              type="radio"
              name="then-branch"
              checked={thenBranchMode === 'call'}
              onChange={() => handleThenBranchMode('call')}
              disabled={!hasFunctions}
            />
            Call function
          </label>
        </div>
        {!hasSteps && thenBranchMode !== 'call' && (
          <span className="field-hint">No top-level steps available for jump target.</span>
        )}
        {!hasFunctions && thenBranchMode !== 'jump' && (
          <span className="field-hint">No functions defined — add one in the outline first.</span>
        )}
      </div>

      {thenBranchMode === 'jump' && hasSteps && (
        <SelectField
          label="Then: jump to step"
          value={action.thenStep ?? stepOptions[0]?.value ?? ''}
          onChange={(thenStep) => onChange({ thenStep })}
          options={[{ value: '', label: '-- select --' }, ...stepOptions]}
          error={errors['thenStep']}
        />
      )}

      {thenBranchMode === 'call' && hasFunctions && (
        <SelectField
          label="Then: call function"
          value={action.thenCall ?? functionOptions[0]?.value ?? ''}
          onChange={(thenCall) => onChange({ thenCall })}
          options={[{ value: '', label: '-- select --' }, ...functionOptions]}
          error={errors['thenCall']}
        />
      )}

      {/* Branching — Else */}
      <div className="field">
        <span>Else (if false)</span>
        <div className="radio-row">
          <label className="radio-label">
            <input
              type="radio"
              name="else-branch"
              checked={elseBranchMode === 'none'}
              onChange={() => handleElseBranchMode('none')}
            />
            No branch
          </label>
          <label className={`radio-label${!hasSteps ? ' radio-label--disabled' : ''}`}>
            <input
              type="radio"
              name="else-branch"
              checked={elseBranchMode === 'jump'}
              onChange={() => handleElseBranchMode('jump')}
              disabled={!hasSteps}
            />
            Jump to step
          </label>
          <label className={`radio-label${!hasFunctions ? ' radio-label--disabled' : ''}`}>
            <input
              type="radio"
              name="else-branch"
              checked={elseBranchMode === 'call'}
              onChange={() => handleElseBranchMode('call')}
              disabled={!hasFunctions}
            />
            Call function
          </label>
        </div>
      </div>

      {elseBranchMode === 'jump' && hasSteps && (
        <SelectField
          label="Else: jump to step"
          value={action.elseStep ?? stepOptions[0]?.value ?? ''}
          onChange={(elseStep) => onChange({ elseStep })}
          options={[{ value: '', label: '-- select --' }, ...stepOptions]}
          error={errors['elseStep']}
        />
      )}

      {elseBranchMode === 'call' && hasFunctions && (
        <SelectField
          label="Else: call function"
          value={action.elseCall ?? functionOptions[0]?.value ?? ''}
          onChange={(elseCall) => onChange({ elseCall })}
          options={[{ value: '', label: '-- select --' }, ...functionOptions]}
          error={errors['elseCall']}
        />
      )}
    </div>
  );
}
