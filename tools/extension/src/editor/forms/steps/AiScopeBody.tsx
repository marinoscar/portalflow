import React from 'react';
import type { AiScopeAction } from '@portalflow/schema';
import { TextAreaField } from '../fields/TextAreaField';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';
import { NumberField } from '../fields/NumberField';
import { CheckboxField } from '../fields/CheckboxField';
import { TemplateHint } from '../fields/TemplateHint';

interface AiScopeBodyProps {
  action: AiScopeAction;
  onChange: (next: Partial<AiScopeAction>) => void;
  errors: Record<string, string>;
}

type SuccessCheckMode = 'deterministic' | 'ai' | 'llm';

const MODE_OPTIONS = [
  { value: 'fast', label: 'Fast (one LLM call per iteration)' },
  { value: 'agent', label: 'Agent (plan + milestone tracking)' },
];

const CHECK_OPTIONS = [
  { value: 'element_exists', label: 'Element exists' },
  { value: 'url_matches', label: 'URL matches' },
  { value: 'text_contains', label: 'Text contains' },
  { value: 'variable_equals', label: 'Variable equals' },
];

const ALL_ALLOWED_ACTIONS = [
  'navigate',
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'hover',
  'focus',
  'scroll',
  'wait',
  'done',
] as const;

type AllowedActionItem = (typeof ALL_ALLOWED_ACTIONS)[number];

function getSuccessCheckMode(action: AiScopeAction): SuccessCheckMode {
  if (!action.successCheck) return 'llm';
  if (action.successCheck.ai !== undefined) return 'ai';
  return 'deterministic';
}

export function AiScopeBody({ action, onChange, errors }: AiScopeBodyProps) {
  const successCheckMode = getSuccessCheckMode(action);
  const allowedSet = new Set<AllowedActionItem>(
    (action.allowedActions as AllowedActionItem[] | undefined) ?? [],
  );

  function handleSuccessCheckMode(mode: SuccessCheckMode) {
    if (mode === 'llm') {
      onChange({ successCheck: undefined });
    } else if (mode === 'ai') {
      onChange({ successCheck: { ai: '' } });
    } else {
      // deterministic
      onChange({ successCheck: { check: 'element_exists', value: '' } });
    }
  }

  function handleSuccessCheckChange(partial: Partial<NonNullable<AiScopeAction['successCheck']>>) {
    if (!action.successCheck) return;
    onChange({ successCheck: { ...action.successCheck, ...partial } });
  }

  function handleAllowedActionToggle(item: AllowedActionItem, checked: boolean) {
    const next = new Set(allowedSet);
    if (checked) {
      next.add(item);
    } else {
      next.delete(item);
    }
    // When all 11 or none: emit undefined (means "all allowed")
    const arr = ALL_ALLOWED_ACTIONS.filter((a) => next.has(a));
    onChange({ allowedActions: arr.length === 0 || arr.length === ALL_ALLOWED_ACTIONS.length ? undefined : arr });
  }

  return (
    <div>
      {/* Goal */}
      <TextAreaField
        label="Goal"
        value={action.goal}
        onChange={(goal) => onChange({ goal })}
        placeholder="Dismiss the cookie consent banner"
        required
        rows={3}
        error={errors['goal']}
      />
      <TemplateHint />

      {/* Mode */}
      <SelectField
        label="Mode"
        value={action.mode ?? 'fast'}
        onChange={(mode) => onChange({ mode: mode as AiScopeAction['mode'] })}
        options={MODE_OPTIONS}
        error={errors['mode']}
      />

      {action.mode === 'agent' && (
        <NumberField
          label="Max replans"
          value={action.maxReplans ?? 2}
          onChange={(v) => onChange({ maxReplans: v ?? 2 })}
          min={0}
          max={10}
          hint="Maximum number of times the agent may rebuild its plan"
          error={errors['maxReplans']}
        />
      )}

      {/* Success check */}
      <div className="field">
        <span>Success check</span>
        <div className="radio-row">
          <label className="radio-label">
            <input
              type="radio"
              name="aiscope-success-mode"
              checked={successCheckMode === 'deterministic'}
              onChange={() => handleSuccessCheckMode('deterministic')}
            />
            Deterministic check
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="aiscope-success-mode"
              checked={successCheckMode === 'ai'}
              onChange={() => handleSuccessCheckMode('ai')}
            />
            AI check
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="aiscope-success-mode"
              checked={successCheckMode === 'llm'}
              onChange={() => handleSuccessCheckMode('llm')}
            />
            LLM decides (self-terminating)
          </label>
        </div>
      </div>

      {successCheckMode === 'deterministic' && action.successCheck && (
        <>
          <SelectField
            label="Check"
            value={action.successCheck.check ?? 'element_exists'}
            onChange={(check) =>
              handleSuccessCheckChange({
                check: check as NonNullable<AiScopeAction['successCheck']>['check'],
              })
            }
            options={CHECK_OPTIONS}
            required
            error={errors['successCheck.check']}
          />
          <TextField
            label="Value"
            value={action.successCheck.value ?? ''}
            onChange={(value) => handleSuccessCheckChange({ value })}
            placeholder="Expected value for the check"
            required
            error={errors['successCheck.value']}
          />
          <TemplateHint />
        </>
      )}

      {successCheckMode === 'ai' && action.successCheck && (
        <>
          <TextAreaField
            label="AI question"
            value={action.successCheck.ai ?? ''}
            onChange={(ai) => handleSuccessCheckChange({ ai })}
            placeholder="Is the cookie banner gone?"
            required
            error={errors['successCheck.ai']}
          />
          <TemplateHint />
        </>
      )}

      {successCheckMode === 'llm' && (
        <p className="muted">
          The LLM self-terminates by emitting a done action when it believes the goal is reached.
          Budget caps (maxDurationSec / maxIterations) are the only safety net.
        </p>
      )}

      {/* Budgets */}
      <details className="form-details" open>
        <summary className="form-details-summary">Budgets</summary>
        <div className="form-details-body">
          <NumberField
            label="Max duration"
            value={action.maxDurationSec ?? 300}
            onChange={(v) => onChange({ maxDurationSec: v ?? 300 })}
            min={1}
            max={3600}
            suffix="seconds"
            error={errors['maxDurationSec']}
          />

          <NumberField
            label="Max iterations"
            value={action.maxIterations ?? 25}
            onChange={(v) => onChange({ maxIterations: v ?? 25 })}
            min={1}
            max={200}
            error={errors['maxIterations']}
          />

          <CheckboxField
            label="Include screenshot"
            checked={action.includeScreenshot ?? true}
            onChange={(includeScreenshot) => onChange({ includeScreenshot })}
            hint="Requires a vision-capable model"
          />
        </div>
      </details>

      {/* Allowed actions */}
      <div className="field">
        <span>Allowed actions</span>
        <span className="field-hint">
          Leave all unchecked to allow everything. Check a subset to restrict the LLM's available
          actions.
        </span>
        <div className="allowed-actions-grid">
          {ALL_ALLOWED_ACTIONS.map((item) => (
            <label key={item} className="field-checkbox-label">
              <input
                type="checkbox"
                checked={allowedSet.has(item)}
                onChange={(e) => handleAllowedActionToggle(item, e.target.checked)}
              />
              <span className="field-checkbox-text">{item}</span>
            </label>
          ))}
        </div>
        {errors['allowedActions'] && (
          <span className="field-error">{errors['allowedActions']}</span>
        )}
      </div>
    </div>
  );
}
