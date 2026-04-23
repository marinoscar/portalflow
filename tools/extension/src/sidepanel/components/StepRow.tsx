import { useState } from 'react';
import type {
  Step,
  NavigateAction,
  InteractAction,
  WaitAction,
  ToolCallAction,
  GotoAction,
  AiScopeAction,
  Selectors,
} from '@portalflow/schema';
import { useHasActiveProvider, useLlmCall } from '../hooks/useLlm';
import { VaultModal } from './VaultModal';
import { SmsOtpModal } from './SmsOtpModal';

interface Props {
  step: Step;
  index: number;
  total: number;
  onUpdate: (changes: Partial<Step>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onConvertToVault?: (secretName: string, inputName: string) => void;
  onInsertOtpBefore?: (sender: string, timeoutSeconds: string) => void;
}

export function StepRow({
  step,
  index,
  total,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onConvertToVault,
  onInsertOtpBefore,
}: Props) {
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
      {expanded && (
        <StepEditor
          step={step}
          onUpdate={onUpdate}
          onConvertToVault={onConvertToVault}
          onInsertOtpBefore={onInsertOtpBefore}
        />
      )}
    </div>
  );
}

function StepEditor({
  step,
  onUpdate,
  onConvertToVault,
  onInsertOtpBefore,
}: {
  step: Step;
  onUpdate: (changes: Partial<Step>) => void;
  onConvertToVault?: (secretName: string, inputName: string) => void;
  onInsertOtpBefore?: (sender: string, timeoutSeconds: string) => void;
}) {
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);

  // Determine if conversion banners should show
  const isTypeInteractWithoutRef =
    step.type === 'interact' &&
    (step.action as InteractAction).interaction === 'type' &&
    !(step.action as InteractAction).inputRef;

  return (
    <div className="step-editor">
      {isTypeInteractWithoutRef && (
        <div className="conversion-banners">
          {onConvertToVault && (
            <button
              className="banner banner-warning"
              onClick={() => setShowVaultModal(true)}
              type="button"
            >
              <strong>Contains a secret?</strong> Convert to a vaultcli credential &rarr;
            </button>
          )}
          {onInsertOtpBefore && (
            <button
              className="banner banner-info"
              onClick={() => setShowOtpModal(true)}
              type="button"
            >
              <strong>Entering an OTP?</strong> Insert an smscli retrieval step &rarr;
            </button>
          )}
        </div>
      )}

      {showVaultModal && onConvertToVault && (
        <VaultModal
          onConfirm={({ vaultKey, inputName }) => {
            onConvertToVault(vaultKey, inputName);
            setShowVaultModal(false);
          }}
          onCancel={() => setShowVaultModal(false)}
        />
      )}

      {showOtpModal && onInsertOtpBefore && (
        <SmsOtpModal
          onConfirm={({ sender, timeout }) => {
            onInsertOtpBefore(sender, timeout);
            setShowOtpModal(false);
          }}
          onCancel={() => setShowOtpModal(false)}
        />
      )}

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
      {step.type === 'goto' && (
        <GotoEditor action={step.action as GotoAction} onUpdate={onUpdate} />
      )}
      {step.type === 'aiscope' && (
        <AiScopeEditor action={step.action as AiScopeAction} onUpdate={onUpdate} />
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

function GotoEditor({
  action,
  onUpdate,
}: {
  action: GotoAction;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  return (
    <>
      <label className="field">
        <span>Jump to step id</span>
        <input
          type="text"
          value={action.targetStepId}
          onChange={(e) =>
            onUpdate({ action: { ...action, targetStepId: e.target.value } })
          }
          placeholder="step-1"
        />
      </label>
      <p className="hint-small">
        Resets the runner's instruction pointer to the named top-level step. Templates
        like <code>{'{{varName}}'}</code> are allowed. Jumps are scoped to the top level
        only — you cannot target steps inside a loop or function body.
      </p>
    </>
  );
}

/**
 * Editor for the `aiscope` step type. Exposes the goal, the success
 * check (either a deterministic check+value, an AI yes/no question, or
 * "LLM decides" — omit successCheck entirely and let the LLM self-
 * terminate via `done`), the dual budgets (maxDurationSec and
 * maxIterations), and the include-screenshot toggle.
 */
function AiScopeEditor({
  action,
  onUpdate,
}: {
  action: AiScopeAction;
  onUpdate: (changes: Partial<Step>) => void;
}) {
  const successCheck = action.successCheck ?? {};
  const hasSuccessCheck = action.successCheck !== undefined;
  const isAiCheck = hasSuccessCheck && successCheck.ai !== undefined;
  const checkMode: 'ai' | 'deterministic' | 'llm_decides' = !hasSuccessCheck
    ? 'llm_decides'
    : isAiCheck
      ? 'ai'
      : 'deterministic';

  const updateAction = (next: Partial<AiScopeAction>) => {
    onUpdate({ action: { ...action, ...next } as Step['action'] });
  };

  const setCheckMode = (mode: 'ai' | 'deterministic' | 'llm_decides') => {
    if (mode === 'llm_decides') {
      // Omit successCheck entirely so the runner self-terminates
      // on the LLM's `done` emission.
      const { successCheck: _dropped, ...rest } = action;
      onUpdate({ action: rest as Step['action'] });
    } else if (mode === 'ai') {
      updateAction({
        successCheck: { ai: successCheck.ai ?? '' },
      } as Partial<AiScopeAction>);
    } else {
      updateAction({
        successCheck: {
          check: successCheck.check ?? 'element_exists',
          value: successCheck.value ?? '',
        },
      } as Partial<AiScopeAction>);
    }
  };

  const executionMode = action.mode ?? 'fast';

  return (
    <>
      <label className="field">
        <span>Goal</span>
        <textarea
          value={action.goal ?? ''}
          onChange={(e) => updateAction({ goal: e.target.value })}
          placeholder="e.g. Dismiss the cookie banner and land on the signed-in dashboard"
          rows={2}
        />
      </label>

      <label className="field">
        <span>Execution mode</span>
        <select
          value={executionMode}
          onChange={(e) =>
            updateAction({ mode: e.target.value as 'fast' | 'agent' } as Partial<AiScopeAction>)
          }
        >
          <option value="fast">Fast — one action per iteration (default)</option>
          <option value="agent">Agent — plan + milestones</option>
        </select>
      </label>

      {executionMode === 'agent' && (
        <>
          <p className="hint">
            Agent mode opens the step with a planning call (one extra LLM round-trip)
            that produces a list of milestones, then reasons about the plan on every
            iteration. Roughly 1.5-3× the tokens of fast mode, but succeeds on compound
            goals (login + navigate + extract + confirm) where fast mode plateaus.
            Use fast mode for single-phase goals.
          </p>
          <label className="field">
            <span>Max replans</span>
            <input
              type="number"
              min={0}
              max={10}
              value={action.maxReplans ?? 2}
              onChange={(e) =>
                updateAction({ maxReplans: parseInt(e.target.value, 10) || 2 })
              }
            />
          </label>
        </>
      )}

      <label className="field">
        <span>Success check mode</span>
        <select
          value={checkMode}
          onChange={(e) =>
            setCheckMode(e.target.value as 'ai' | 'deterministic' | 'llm_decides')
          }
        >
          <option value="deterministic">Deterministic (check + value)</option>
          <option value="ai">AI (plain-English question)</option>
          <option value="llm_decides">LLM decides (no success check)</option>
        </select>
      </label>

      {checkMode === 'llm_decides' && (
        <p className="hint">
          No success check. The LLM terminates the loop by emitting <code>done</code> once
          it believes the goal is reached. Only budget caps (max duration / iterations)
          stop an over-confident model. Use when the goal is hard to state as a concrete
          predicate.
        </p>
      )}

      {checkMode === 'deterministic' && (
        <>
          <label className="field">
            <span>Check</span>
            <select
              value={successCheck.check ?? 'element_exists'}
              onChange={(e) =>
                updateAction({
                  successCheck: {
                    check: e.target.value as
                      | 'element_exists'
                      | 'url_matches'
                      | 'text_contains'
                      | 'variable_equals',
                    value: successCheck.value ?? '',
                  },
                } as Partial<AiScopeAction>)
              }
            >
              <option value="element_exists">element_exists</option>
              <option value="url_matches">url_matches</option>
              <option value="text_contains">text_contains</option>
              <option value="variable_equals">variable_equals</option>
            </select>
          </label>
          <label className="field">
            <span>Check value</span>
            <input
              type="text"
              value={successCheck.value ?? ''}
              onChange={(e) =>
                updateAction({
                  successCheck: {
                    check: successCheck.check ?? 'element_exists',
                    value: e.target.value,
                  },
                } as Partial<AiScopeAction>)
              }
              placeholder="e.g. button.logged-in  /  /dashboard  /  varName=expected"
            />
          </label>
        </>
      )}

      {checkMode === 'ai' && (
        <label className="field">
          <span>Success question (AI)</span>
          <textarea
            value={successCheck.ai ?? ''}
            onChange={(e) =>
              updateAction({
                successCheck: { ai: e.target.value },
              } as Partial<AiScopeAction>)
            }
            placeholder="e.g. Is the user logged in and the dashboard visible?"
            rows={2}
          />
        </label>
      )}

      <label className="field">
        <span>Max duration (seconds)</span>
        <input
          type="number"
          min={1}
          max={3600}
          value={action.maxDurationSec ?? 300}
          onChange={(e) =>
            updateAction({ maxDurationSec: parseInt(e.target.value, 10) || 300 })
          }
        />
      </label>

      <label className="field">
        <span>Max iterations</span>
        <input
          type="number"
          min={1}
          max={200}
          value={action.maxIterations ?? 25}
          onChange={(e) =>
            updateAction({ maxIterations: parseInt(e.target.value, 10) || 25 })
          }
        />
      </label>

      <label className="field">
        <span>Include screenshot in LLM input</span>
        <input
          type="checkbox"
          checked={action.includeScreenshot ?? true}
          onChange={(e) => updateAction({ includeScreenshot: e.target.checked })}
        />
      </label>

      <p className="hint-small">
        Hands control to the LLM for a bounded goal-driven sub-run. The runner
        stops as soon as the success check passes, or when either budget cap
        fires. Screenshots are sent to the LLM on every iteration by default —
        uncheck to use HTML-only input when the model is not vision-capable.
      </p>
    </>
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
            onUpdate({
              action: { ...action, interaction: e.target.value as InteractAction['interaction'] },
            })
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
            onUpdate({
              action: { ...action, condition: e.target.value as WaitAction['condition'] },
            })
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
  const updateArg = (key: string, value: string) => {
    const nextArgs = { ...(action.args ?? {}) };
    if (value === '' || value === undefined) {
      delete nextArgs[key];
    } else {
      nextArgs[key] = value;
    }
    onUpdate({ action: { ...action, args: nextArgs } });
  };

  const toolSelect = (
    <label className="field">
      <span>Tool</span>
      <select
        value={action.tool}
        onChange={(e) => {
          const nextTool = e.target.value as ToolCallAction['tool'];
          const defaults: Partial<ToolCallAction> =
            nextTool === 'vaultcli'
              ? { tool: nextTool, command: 'secrets-get', args: {} }
              : nextTool === 'smscli'
                ? { tool: nextTool, command: 'otp-wait', args: {} }
                : { tool: nextTool, command: '', args: {} };
          onUpdate({ action: { ...action, ...defaults } });
        }}
      >
        <option value="smscli">smscli</option>
        <option value="vaultcli">vaultcli</option>
      </select>
    </label>
  );

  const outputNameField = (placeholder: string) => (
    <label className="field">
      <span>Output name</span>
      <input
        type="text"
        value={action.outputName ?? ''}
        onChange={(e) => onUpdate({ action: { ...action, outputName: e.target.value } })}
        placeholder={placeholder}
      />
    </label>
  );

  if (action.tool === 'vaultcli') {
    const args = action.args ?? {};
    const outputName = (action.outputName ?? 'creds').trim() || 'creds';
    return (
      <>
        {toolSelect}
        <label className="field">
          <span>Command</span>
          <select
            value={action.command || 'secrets-get'}
            onChange={(e) => onUpdate({ action: { ...action, command: e.target.value } })}
          >
            <option value="secrets-get">secrets-get</option>
          </select>
        </label>
        <label className="field">
          <span>Secret name</span>
          <input
            type="text"
            value={args['name'] ?? ''}
            onChange={(e) => updateArg('name', e.target.value)}
            placeholder="att"
          />
        </label>
        <label className="field">
          <span>Field (optional)</span>
          <input
            type="text"
            value={args['field'] ?? ''}
            onChange={(e) => updateArg('field', e.target.value)}
            placeholder="password — leave empty to expose all fields"
          />
        </label>
        {outputNameField('creds')}
        <p className="hint-small">
          Omit <code>field</code> to expose every key in the secret as{' '}
          <code>{`{{${outputName}_<field>}}`}</code> (e.g.{' '}
          <code>{`{{${outputName}_username}}`}</code>,{' '}
          <code>{`{{${outputName}_password}}`}</code>).
        </p>
      </>
    );
  }

  if (action.tool === 'smscli') {
    const args = action.args ?? {};
    const command = action.command || 'otp-wait';
    const isWait = command === 'otp-wait';
    const isLatest = command === 'otp-latest';
    const isExtract = command === 'otp-extract';
    return (
      <>
        {toolSelect}
        <label className="field">
          <span>Command</span>
          <select
            value={command}
            onChange={(e) => onUpdate({ action: { ...action, command: e.target.value } })}
          >
            <option value="otp-wait">otp-wait (wait for a new SMS)</option>
            <option value="otp-latest">otp-latest (most recent OTP)</option>
            <option value="otp-extract">otp-extract (from literal message)</option>
          </select>
        </label>
        {(isWait || isLatest) && (
          <>
            <label className="field">
              <span>Sender (optional)</span>
              <input
                type="text"
                value={args['sender'] ?? ''}
                onChange={(e) => updateArg('sender', e.target.value)}
                placeholder="MyBank"
              />
            </label>
            <label className="field">
              <span>Number (optional)</span>
              <input
                type="text"
                value={args['number'] ?? ''}
                onChange={(e) => updateArg('number', e.target.value)}
                placeholder="+15551234567"
              />
            </label>
          </>
        )}
        {isWait && (
          <>
            <label className="field">
              <span>Timeout (seconds)</span>
              <input
                type="number"
                value={args['timeout'] ?? '60'}
                onChange={(e) => updateArg('timeout', e.target.value)}
                placeholder="60"
                min={1}
              />
            </label>
            <p className="hint-small">
              On timeout, the runtime automatically retries <code>smscli otp latest</code> with
              the same filters. You don&apos;t need a separate fallback step.
            </p>
          </>
        )}
        {isExtract && (
          <label className="field">
            <span>Message body</span>
            <textarea
              value={args['message'] ?? ''}
              onChange={(e) => updateArg('message', e.target.value)}
              placeholder="Your verification code is 483921"
              rows={3}
            />
          </label>
        )}
        {outputNameField('otpCode')}
      </>
    );
  }

  // Generic fallback editor for any future tool.
  return (
    <>
      {toolSelect}
      <label className="field">
        <span>Command</span>
        <input
          type="text"
          value={action.command}
          onChange={(e) => onUpdate({ action: { ...action, command: e.target.value } })}
          placeholder="command"
        />
      </label>
      {outputNameField('result')}
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
  const hasProvider = useHasActiveProvider();
  const { call, loading } = useLlmCall();

  if (
    step.type === 'navigate' ||
    step.type === 'wait' ||
    step.type === 'tool_call' ||
    step.type === 'condition' ||
    step.type === 'goto' ||
    step.type === 'aiscope'
  ) {
    return null;
  }

  const selectors: Selectors = step.selectors ?? { primary: '' };

  const handleImproveSelector = async () => {
    const result = await call<{ primary: string; fallbacks?: string[] }>({
      type: 'LLM_IMPROVE_SELECTOR',
      stepDescription: step.name + (step.description ? ` — ${step.description}` : ''),
      currentSelector: selectors.primary,
    });
    if (result && result.primary) {
      onUpdate({
        selectors: {
          primary: result.primary,
          fallbacks: result.fallbacks ?? [],
        },
      });
    }
  };

  const handleGenerateGuidance = async () => {
    const result = await call<string>({
      type: 'LLM_GENERATE_GUIDANCE',
      stepDescription: step.name + (step.description ? ` — ${step.description}` : ''),
    });
    if (result) onUpdate({ aiGuidance: result });
  };

  return (
    <>
      <label className="field">
        <span>
          Primary selector
          <button
            type="button"
            className="btn-inline-llm"
            onClick={handleImproveSelector}
            disabled={!hasProvider || loading}
            title={
              !hasProvider
                ? 'Configure an LLM provider in settings'
                : 'Suggest a more stable selector'
            }
          >
            {loading ? '...' : 'Improve with LLM'}
          </button>
        </span>
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
        <span>
          AI guidance
          <button
            type="button"
            className="btn-inline-llm"
            onClick={handleGenerateGuidance}
            disabled={!hasProvider || loading}
            title={
              !hasProvider
                ? 'Configure an LLM provider in settings'
                : 'Generate a natural-language hint'
            }
          >
            {loading ? '...' : 'Generate with LLM'}
          </button>
        </span>
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
