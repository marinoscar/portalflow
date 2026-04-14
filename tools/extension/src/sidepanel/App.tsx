import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { sendMessage } from '../shared/messaging';
import type { RecordingSession } from '../shared/types';
import type { Message } from '../shared/messaging';
import type { Input, Step } from '@portalflow/schema';
import { automationReducer, initialAutomationState } from './state/automation-state';
import { eventsToAutomation } from '../converter/events-to-automation';
import { AiAssistant } from './components/AiAssistant';
import { MetadataForm } from './components/MetadataForm';
import { InputsList } from './components/InputsList';
import { StepRow } from './components/StepRow';
import { ExportBar } from './components/ExportBar';
import { LlmNotConfiguredBanner } from './components/LlmNotConfiguredBanner';
import { useUndoRedoShortcuts } from './hooks/useKeyboardShortcuts';
import './app.css';

const AUTO_COMMIT_DEBOUNCE_MS = 2000;

export function App() {
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [state, dispatch] = useReducer(automationReducer, initialAutomationState);

  // Load current session on mount
  useEffect(() => {
    let mounted = true;
    sendMessage<{ session: RecordingSession | null }>({ type: 'GET_SESSION_STATUS' })
      .then((resp) => {
        if (mounted) {
          setSession(resp?.session ?? null);
          setLoading(false);
        }
      })
      .catch(() => mounted && setLoading(false));

    const listener = (msg: Message) => {
      if (msg.type === 'SESSION_UPDATED') {
        setSession(msg.session);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      mounted = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // Auto-derive the automation from session events, unless the user is editing
  useEffect(() => {
    if (editing || !session) return;
    if (session.events.length === 0) {
      dispatch({ type: 'CLEAR_AUTOMATION' });
      return;
    }
    const automation = eventsToAutomation(session);
    dispatch({ type: 'SET_AUTOMATION', automation });
  }, [session, editing]);

  // --- control handlers ---

  const start = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      alert('No active tab');
      return;
    }
    setEditing(false);
    const resp = await sendMessage<{ session: RecordingSession }>({
      type: 'START_RECORDING',
      tabId: tab.id,
    });
    setSession(resp.session);
  };

  const stop = async () => {
    const resp = await sendMessage<{ session: RecordingSession }>({ type: 'STOP_RECORDING' });
    setSession(resp.session);
  };

  const clear = async () => {
    await sendMessage({ type: 'CLEAR_SESSION' });
    setSession(null);
    dispatch({ type: 'CLEAR_AUTOMATION' });
    setEditing(false);
  };

  const rederive = () => {
    setEditing(false);
    if (session) {
      const automation = eventsToAutomation(session);
      dispatch({ type: 'SET_AUTOMATION', automation });
    }
  };

  const revertToOriginal = () => {
    if (!session?.original) return;
    setEditing(false);
    dispatch({ type: 'SET_AUTOMATION', automation: session.original });
  };

  // Seed the version history with a raw-recording entry the first time
  // the converter produces an automation AND no versions exist yet.
  useEffect(() => {
    if (!state.automation) return;
    if (state.versions.length > 0) return;
    if (editing) return;
    dispatch({
      type: 'COMMIT_VERSION',
      author: 'raw-recording',
      message: `Initial recording (${session?.events.length ?? 0} events)`,
    });
    // We deliberately do NOT depend on `state` as a whole to avoid a
    // feedback loop. Only the presence of an automation and the empty
    // versions list matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.automation, state.versions.length, editing]);

  // Auto-commit a user-edit version after AUTO_COMMIT_DEBOUNCE_MS of idle
  // time following a manual edit. Typing/clicking resets the timer so
  // rapid edits coalesce into a single committed version.
  const commitTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!editing || !state.automation) return;
    if (state.versions.length === 0) return; // wait for raw-recording seed
    if (commitTimer.current !== null) {
      window.clearTimeout(commitTimer.current);
    }
    commitTimer.current = window.setTimeout(() => {
      dispatch({
        type: 'COMMIT_VERSION',
        author: 'user-edit',
        message: 'Manual edit',
      });
      commitTimer.current = null;
    }, AUTO_COMMIT_DEBOUNCE_MS);
    return () => {
      if (commitTimer.current !== null) {
        window.clearTimeout(commitTimer.current);
      }
    };
  }, [state.automation, editing, state.versions.length]);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  useUndoRedoShortcuts(undo, redo);

  // Determine button enablement for the history controls.
  const headIdx = state.versions.findIndex((v) => v.id === state.currentVersionId);
  const canUndo = headIdx > 0;
  const canRedo = headIdx >= 0 && headIdx < state.versions.length - 1;

  // --- edit helpers ---

  const beginEdit = () => setEditing(true);

  const addInput = () => {
    beginEdit();
    const newInput: Input = {
      name: `input${(state.automation?.inputs.length ?? 0) + 1}`,
      type: 'string',
      required: true,
      source: 'literal',
      value: '',
    };
    dispatch({ type: 'ADD_INPUT', input: newInput });
  };

  // --- render ---

  if (loading) return <div className="app"><p>Loading...</p></div>;

  const status = session?.status ?? 'idle';
  const eventCount = session?.events.length ?? 0;
  const automation = state.automation;

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-title">
          <h1>PortalFlow Recorder</h1>
          <span className={`status-pill status-${status}`}>{status}</span>
        </div>
        <div className="app-header-actions">
          <button
            className="app-header-icon-button"
            onClick={undo}
            disabled={!canUndo}
            title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
            aria-label="Undo"
            type="button"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            className="app-header-icon-button"
            onClick={redo}
            disabled={!canRedo}
            title={canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo'}
            aria-label="Redo"
            type="button"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        <button
          className="app-settings-button"
          onClick={openOptions}
          title="Open extension settings"
          aria-label="Open extension settings"
          type="button"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        </div>
      </header>
      <main className="app-main">
        <LlmNotConfiguredBanner />
        <section className="card">
          <h2 className="card-title">Recording</h2>
          <div className="controls">
            {status === 'idle' && (
              <button className="btn-primary" onClick={start}>
                Start recording
              </button>
            )}
            {status === 'recording' && (
              <button className="btn-primary" onClick={stop}>
                Stop
              </button>
            )}
            {status === 'stopped' && (
              <>
                <button className="btn-primary" onClick={start}>
                  Record again
                </button>
                <button className="btn-secondary" onClick={clear}>
                  Clear
                </button>
              </>
            )}
            {editing && status !== 'recording' && (
              <button className="btn-secondary" onClick={rederive}>
                Reset to recording
              </button>
            )}
            {editing && status !== 'recording' && session?.original && (
              <button
                className="btn-secondary"
                onClick={revertToOriginal}
                title="Restore the original automation as it was first converted from the recording. Keeps all recorded events intact, discards post-recording edits."
              >
                Revert to original
              </button>
            )}
          </div>
          <div className="event-counter">
            {eventCount} event{eventCount === 1 ? '' : 's'} captured
          </div>
        </section>

        {automation && (
          <>
            <AiAssistant
              automation={automation}
              onUpdateMetadata={(changes) => {
                beginEdit();
                dispatch({ type: 'UPDATE_METADATA', changes });
              }}
              onReplaceSteps={(steps) => {
                beginEdit();
                dispatch({ type: 'REPLACE_STEPS', steps });
              }}
            />
            <MetadataForm
              automation={automation}
              onChange={(changes) => {
                beginEdit();
                dispatch({ type: 'UPDATE_METADATA', changes });
              }}
            />

            <InputsList
              inputs={automation.inputs}
              onAdd={addInput}
              onUpdate={(index, changes) => {
                beginEdit();
                dispatch({ type: 'UPDATE_INPUT', index, changes });
              }}
              onRemove={(index) => {
                beginEdit();
                dispatch({ type: 'REMOVE_INPUT', index });
              }}
            />

            <section className="card">
              <h2 className="card-title">Steps ({automation.steps.length})</h2>
              {automation.steps.length === 0 && (
                <p className="muted">No steps captured yet.</p>
              )}
              {automation.steps.map((step, idx) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={idx}
                  total={automation.steps.length}
                  onUpdate={(changes: Partial<Step>) => {
                    beginEdit();
                    dispatch({ type: 'UPDATE_STEP', index: idx, changes });
                  }}
                  onRemove={() => {
                    beginEdit();
                    dispatch({ type: 'REMOVE_STEP', index: idx });
                  }}
                  onMoveUp={() => {
                    beginEdit();
                    dispatch({ type: 'MOVE_STEP', from: idx, to: idx - 1 });
                  }}
                  onMoveDown={() => {
                    beginEdit();
                    dispatch({ type: 'MOVE_STEP', from: idx, to: idx + 1 });
                  }}
                  onConvertToVault={(vaultKey, inputName) => {
                    beginEdit();
                    const existing = automation.inputs.find((i) => i.name === inputName);
                    if (!existing) {
                      dispatch({
                        type: 'ADD_INPUT',
                        input: {
                          name: inputName,
                          type: 'secret',
                          required: true,
                          source: 'vaultcli',
                          value: vaultKey,
                          description: 'Retrieved from vaultcli',
                        },
                      });
                    }
                    dispatch({
                      type: 'UPDATE_STEP',
                      index: idx,
                      changes: {
                        action: {
                          interaction: 'type',
                          inputRef: inputName,
                        } as Step['action'],
                      },
                    });
                  }}
                  onInsertOtpBefore={(sender, pattern) => {
                    beginEdit();
                    const newToolStep: Step = {
                      id: `step-${idx + 1}`,
                      name: 'Retrieve OTP via smscli',
                      type: 'tool_call',
                      action: {
                        tool: 'smscli',
                        command: 'get-otp',
                        args: { sender, pattern },
                        outputName: 'otpCode',
                      },
                      onFailure: 'abort',
                      maxRetries: 1,
                      timeout: 120000,
                    };
                    dispatch({
                      type: 'INSERT_STEP',
                      index: idx,
                      step: newToolStep,
                    });
                    dispatch({
                      type: 'UPDATE_STEP',
                      index: idx + 1,
                      changes: {
                        action: { interaction: 'type', inputRef: 'otpCode' } as Step['action'],
                      },
                    });
                  }}
                />
              ))}
            </section>

            <ExportBar automation={automation} />
          </>
        )}
      </main>
    </div>
  );
}
