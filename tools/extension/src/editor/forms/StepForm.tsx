import React from 'react';
import type { Step, StepType } from '@portalflow/schema';
import type { EditorAction, ValidationResult } from '../state/editor-state';
import { TextField } from './fields/TextField';
import { TextAreaField } from './fields/TextAreaField';
import { SelectField } from './fields/SelectField';
import { NumberField } from './fields/NumberField';
import { TemplateHint } from './fields/TemplateHint';
import { SelectorsEditor } from './fields/SelectorsEditor';
import { ValidationEditor } from './fields/ValidationEditor';
import { fieldErrorsForPath } from './errors';

// ---------------------------------------------------------------------------
// Default action shapes for each step type
// ---------------------------------------------------------------------------

export function defaultActionForType(type: StepType): Step['action'] {
  switch (type) {
    case 'navigate':
      return { url: '' };
    case 'interact':
      return { interaction: 'click' };
    case 'wait':
      return { condition: 'delay', value: '1000' };
    case 'extract':
      return { target: 'text', outputName: '' };
    case 'tool_call':
      return { tool: 'smscli', command: 'otp-wait' };
    case 'condition':
      return { check: 'element_exists', value: '' };
    case 'download':
      return { trigger: 'click' };
    case 'loop':
      return { maxIterations: 10, indexVar: 'loop_index' };
    case 'call':
      return { function: '' };
    case 'goto':
      return { targetStepId: '' };
    case 'aiscope':
      return {
        goal: '',
        mode: 'fast',
        maxDurationSec: 300,
        maxIterations: 25,
        includeScreenshot: true,
        maxReplans: 2,
      };
  }
}

// ---------------------------------------------------------------------------
// Step type options
// ---------------------------------------------------------------------------

const STEP_TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: 'navigate', label: 'Navigate' },
  { value: 'interact', label: 'Interact' },
  { value: 'wait', label: 'Wait' },
  { value: 'extract', label: 'Extract' },
  { value: 'tool_call', label: 'Tool call' },
  { value: 'condition', label: 'Condition' },
  { value: 'download', label: 'Download' },
  { value: 'loop', label: 'Loop' },
  { value: 'call', label: 'Call function' },
  { value: 'goto', label: 'Go to step' },
  { value: 'aiscope', label: 'AI scope' },
];

const ON_FAILURE_OPTIONS = [
  { value: 'abort', label: 'Abort' },
  { value: 'retry', label: 'Retry' },
  { value: 'skip', label: 'Skip' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StepFormProps {
  step: Step;
  /** Path within the step array (top-level or function body) */
  path: number[];
  /**
   * When editing a step inside a function body, provide the function index.
   * This is forwarded to the reducer so it operates on the correct array.
   */
  functionIndex?: number;
  dispatch: React.Dispatch<EditorAction>;
  validation: ValidationResult;
}

// ---------------------------------------------------------------------------
// StepForm
// ---------------------------------------------------------------------------

export function StepForm({ step, path, functionIndex, dispatch, validation }: StepFormProps) {
  // Build the Zod path prefix for this step's position
  const basePath: (string | number)[] =
    functionIndex !== undefined
      ? ['functions', functionIndex, 'steps', ...path]
      : ['steps', ...path];

  const stepErrors = fieldErrorsForPath(validation, basePath);
  const actionErrors = fieldErrorsForPath(validation, [...basePath, 'action']);

  function updateStep(changes: Partial<Step>) {
    dispatch({
      type: 'UPDATE_STEP',
      payload: { path, changes, functionIndex },
    });
  }

  function handleTypeChange(newType: string) {
    if (newType === step.type) return;
    const confirmed = window.confirm(
      `Changing step type from "${step.type}" to "${newType}" will reset the action fields. Continue?`,
    );
    if (!confirmed) return;
    updateStep({
      type: newType as StepType,
      action: defaultActionForType(newType as StepType),
    });
  }

  return (
    <div className="form-section">
      {/* Identity block */}
      <div className="form-section-title">Step</div>

      <SelectField
        label="Type"
        value={step.type}
        onChange={handleTypeChange}
        options={STEP_TYPE_OPTIONS}
        required
      />

      <TextField
        label="Name"
        value={step.name}
        onChange={(name) => updateStep({ name })}
        placeholder="Step name"
        required
        error={stepErrors['name']}
      />

      <TextAreaField
        label="Description"
        value={step.description ?? ''}
        onChange={(description) => updateStep({ description: description || undefined })}
        placeholder="What this step does"
      />

      {/* Type-specific body — Phase F will replace this placeholder */}
      <section className="form-section">
        <div className="form-section-title">Action</div>
        <p className="muted">
          Type-specific fields coming in Phase F for step type &ldquo;{step.type}&rdquo;
        </p>
      </section>

      {/* Common fields — collapsible */}
      <details className="form-details">
        <summary className="form-details-summary">Step details</summary>
        <div className="form-details-body">
          <TextAreaField
            label="AI guidance"
            value={step.aiGuidance ?? ''}
            onChange={(aiGuidance) => updateStep({ aiGuidance: aiGuidance || undefined })}
            placeholder="Hint to the AI for this step"
          />
          <TemplateHint />

          <SelectorsEditor
            value={step.selectors}
            onChange={(selectors) => updateStep({ selectors })}
            errors={fieldErrorsForPath(validation, [...basePath, 'selectors'])}
          />

          <ValidationEditor
            value={step.validation}
            onChange={(val) => updateStep({ validation: val })}
            errors={fieldErrorsForPath(validation, [...basePath, 'validation'])}
          />
        </div>
      </details>

      {/* Execution behavior — collapsible */}
      <details className="form-details">
        <summary className="form-details-summary">On failure</summary>
        <div className="form-details-body">
          <SelectField
            label="On failure"
            value={step.onFailure}
            onChange={(onFailure) => updateStep({ onFailure: onFailure as Step['onFailure'] })}
            options={ON_FAILURE_OPTIONS}
          />

          <NumberField
            label="Max retries"
            value={step.maxRetries}
            onChange={(v) => updateStep({ maxRetries: v ?? 0 })}
            min={0}
            max={10}
            error={stepErrors['maxRetries']}
          />

          <NumberField
            label="Timeout"
            value={step.timeout}
            onChange={(v) => updateStep({ timeout: v ?? 0 })}
            min={0}
            suffix="ms"
            error={stepErrors['timeout']}
          />
          {step.type === 'aiscope' && (
            <p className="muted">
              Note: timeout is ignored for aiscope — use maxDurationSec / maxIterations instead.
            </p>
          )}
        </div>
      </details>

      {/* Suppress unused variable warning */}
      {void actionErrors}
    </div>
  );
}
