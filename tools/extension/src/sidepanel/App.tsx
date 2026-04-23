import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { sendMessage } from '../shared/messaging';
import type { ChatMessage, HtmlSnapshot, RecordingSession } from '../shared/types';
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
import { VersionHistory } from './components/VersionHistory';
import { ChatPanel } from './components/ChatPanel';
import { ConfirmModal } from './components/ConfirmModal';
import { SessionsManagerModal } from './components/SessionsManagerModal';
import { ToastStack, useToasts } from './components/ToastStack';
import { importSession } from './services/session-import';
import { useUndoRedoShortcuts } from './hooks/useKeyboardShortcuts';
import { useHasActiveProvider } from './hooks/useLlm';
import './app.css';

const AUTO_COMMIT_DEBOUNCE_MS = 2000;

export function App() {
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [state, dispatch] = useReducer(automationReducer, initialAutomationState);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showSessionsManager, setShowSessionsManager] = useState(false);

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

  const handleConfirmReset = async () => {
    setShowResetConfirm(false);
    await clear();
    pushToast('info', 'Session reset. Start recording a new one.');
  };

  const handleOpenArchivedSession = (restored: RecordingSession) => {
    setShowSessionsManager(false);
    setEditing(false);
    dispatch({ type: 'CLEAR_AUTOMATION' });
    setSession(restored);
    pushToast('info', 'Opened saved session');
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
    pushToast('info', 'Reverted to the original recording');
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

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
    pushToast('info', 'Undone — walked back one version');
  }, [pushToast]);
  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
    pushToast('info', 'Redone — walked forward one version');
  }, [pushToast]);
  useUndoRedoShortcuts(undo, redo);

  const [historyOpen, setHistoryOpen] = useState(false);
  const checkoutVersion = useCallback(
    (versionId: string) => {
      dispatch({ type: 'CHECKOUT_VERSION', versionId });
      setHistoryOpen(false);
      pushToast('info', 'Checked out version from history');
    },
    [pushToast],
  );

  // Determine button enablement for the history controls.
  const headIdx = state.versions.findIndex((v) => v.id === state.currentVersionId);
  const canUndo = headIdx > 0;
  const canRedo = headIdx >= 0 && headIdx < state.versions.length - 1;

  // --- chat helpers ---

  const hasProvider = useHasActiveProvider();
  const [isChatSending, setIsChatSending] = useState(false);

  const pickRecentSnapshots = useCallback((): HtmlSnapshot[] => {
    if (!session?.snapshots) return [];
    // Walk events from the end, collect the most recent unique snapshotIds,
    // and return their HtmlSnapshot entries. Cap at 3.
    const seen = new Set<string>();
    const picked: HtmlSnapshot[] = [];
    for (let i = session.events.length - 1; i >= 0 && picked.length < 3; i--) {
      const id = session.events[i]?.snapshotId;
      if (!id || seen.has(id)) continue;
      const snap = session.snapshots[id];
      if (snap) {
        seen.add(id);
        picked.unshift(snap);
      }
    }
    return picked;
  }, [session]);

  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!state.automation || isChatSending) return;

      const userMessage: ChatMessage = {
        id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };
      dispatch({ type: 'APPEND_CHAT_MESSAGE', message: userMessage });

      setIsChatSending(true);
      try {
        const resp = (await sendMessage({
          type: 'LLM_CHAT_EDIT',
          request: {
            userMessage: text,
            currentAutomation: state.automation,
            baseVersionId: state.currentVersionId,
            recentSnapshots: pickRecentSnapshots(),
            chatHistory: state.chatHistory.slice(-10),
          },
        })) as
          | { type: 'LLM_RESULT'; ok: true; data: { reply: string; proposal: unknown } }
          | { type: 'LLM_ERROR'; ok: false; error: string };

        if (resp && 'ok' in resp && resp.ok) {
          const parsed = resp.data;
          const rawProposal = (parsed as { proposal: unknown }).proposal;
          const assistant: ChatMessage = {
            id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: parsed.reply,
            createdAt: Date.now(),
            proposal: rawProposal
              ? {
                  id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                  summary: (rawProposal as { summary: string }).summary,
                  changes: (rawProposal as { changes: string[] }).changes,
                  newAutomation: (rawProposal as { newAutomation: typeof state.automation })
                    .newAutomation!,
                  baseVersionId: state.currentVersionId,
                  status: 'pending',
                }
              : undefined,
          };
          dispatch({ type: 'APPEND_CHAT_MESSAGE', message: assistant });
        } else {
          const errText = resp && 'error' in resp ? resp.error : 'Unknown error';
          const assistant: ChatMessage = {
            id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: 'Sorry, I could not process that request.',
            createdAt: Date.now(),
            parseError: errText,
          };
          dispatch({ type: 'APPEND_CHAT_MESSAGE', message: assistant });
        }
      } finally {
        setIsChatSending(false);
      }
    },
    [state.automation, state.currentVersionId, state.chatHistory, isChatSending, pickRecentSnapshots],
  );

  const approveProposal = useCallback(
    (messageId: string) => {
      const msg = state.chatHistory.find((m) => m.id === messageId);
      if (!msg?.proposal) return;
      dispatch({ type: 'UPDATE_PROPOSAL_STATUS', messageId, status: 'approved' });
      dispatch({ type: 'SET_AUTOMATION', automation: msg.proposal.newAutomation });
      dispatch({
        type: 'COMMIT_VERSION',
        author: 'ai-chat',
        message: msg.proposal.summary,
      });
      pushToast('success', `Proposal applied: ${msg.proposal.summary}`);
    },
    [state.chatHistory, pushToast],
  );

  const rejectProposal = useCallback(
    (messageId: string) => {
      dispatch({ type: 'UPDATE_PROPOSAL_STATUS', messageId, status: 'rejected' });
      pushToast('info', 'Proposal rejected');
    },
    [pushToast],
  );

  const clearChat = useCallback(() => {
    dispatch({ type: 'CLEAR_CHAT' });
  }, []);

  // --- session zip import ---

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const openImportPicker = useCallback(() => {
    setImportError(null);
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const file = ev.target.files?.[0];
      // Reset the input so the same file can be re-selected later.
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!file) return;

      if (session && session.status === 'recording') {
        const ok = window.confirm(
          'A recording is in progress. Importing will replace the current session. Continue?',
        );
        if (!ok) return;
      }

      try {
        const imported = await importSession(file);
        // Persist the reconstructed session to chrome.storage.local via the
        // service worker's CLEAR_SESSION + manual save pathway is complex;
        // the simpler approach is to overwrite the UI state directly.
        // Future: introduce an IMPORT_SESSION message type.
        await chrome.storage.local.set({ 'portalflow:session': imported.session });
        setSession(imported.session);
        dispatch({ type: 'SET_AUTOMATION', automation: imported.currentAutomation });
        dispatch({
          type: 'HYDRATE_VERSIONS',
          versions: imported.session.versions ?? [],
          currentVersionId: imported.session.currentVersionId ?? null,
        });
        dispatch({
          type: 'HYDRATE_CHAT',
          chatHistory: imported.session.chatHistory ?? [],
        });
        setEditing(false);
        pushToast(
          'success',
          `Imported session: ${imported.manifest.counts.versions} versions, ${imported.manifest.counts.snapshots} snapshots`,
        );
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
        pushToast('error', 'Import failed — see error banner for details');
      }
    },
    [session, pushToast],
  );

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
            className="app-header-icon-button"
            onClick={() => setHistoryOpen(true)}
            disabled={state.versions.length === 0}
            title="Version history"
            aria-label="Open version history"
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
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button
            className="app-header-icon-button"
            onClick={() => setShowSessionsManager(true)}
            title="Saved sessions"
            aria-label="Open saved sessions"
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
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button
            className="app-header-icon-button"
            onClick={() => setShowResetConfirm(true)}
            disabled={!session}
            title={session ? 'Reset current session' : 'No session to reset'}
            aria-label="Reset current session"
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
              <path d="M3 12a9 9 0 1 0 9-9" />
              <polyline points="3 4 3 10 9 10" />
            </svg>
          </button>
          <button
            className="app-header-icon-button"
            onClick={openImportPicker}
            title="Import session (.zip)"
            aria-label="Import session"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button
            className="app-header-icon-button"
            onClick={() =>
              chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/index.html') })
            }
            title="Open Automation Editor"
            aria-label="Open Automation Editor"
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
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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
        {importError && (
          <div className="error-box" role="alert">
            <strong>Import failed:</strong>
            <p>{importError}</p>
            <button
              className="btn-secondary btn-small"
              onClick={() => setImportError(null)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}
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
                // Flush the pending auto-commit and record this as an
                // ai-improve-legacy version so it's visible in history.
                dispatch({
                  type: 'COMMIT_VERSION',
                  author: 'ai-improve-legacy',
                  message: 'AI polished metadata',
                });
              }}
              onReplaceSteps={(steps) => {
                beginEdit();
                dispatch({ type: 'REPLACE_STEPS', steps });
                dispatch({
                  type: 'COMMIT_VERSION',
                  author: 'ai-improve-legacy',
                  message: 'AI improved steps',
                });
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
                  onConvertToVault={(secretName, inputName) => {
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
                          value: secretName,
                          description: 'Retrieved from vaultcli (multi-field)',
                        },
                      });
                    }
                    // Default the type step to the _password field of the
                    // exploded secret — users can swap to _username, etc.
                    dispatch({
                      type: 'UPDATE_STEP',
                      index: idx,
                      changes: {
                        action: {
                          interaction: 'type',
                          inputRef: `${inputName}_password`,
                        } as Step['action'],
                      },
                    });
                  }}
                  onInsertOtpBefore={(sender, timeoutSeconds) => {
                    beginEdit();
                    const waitArgs: Record<string, string> = { timeout: timeoutSeconds };
                    if (sender) waitArgs['sender'] = sender;
                    const newToolStep: Step = {
                      id: `step-${idx + 1}`,
                      name: 'Retrieve OTP via smscli',
                      type: 'tool_call',
                      action: {
                        tool: 'smscli',
                        command: 'otp-wait',
                        args: waitArgs,
                        outputName: 'otpCode',
                      },
                      onFailure: 'abort',
                      maxRetries: 0,
                      timeout: 180000,
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

            <ExportBar
              automation={automation}
              session={session}
              currentVersionId={state.currentVersionId}
            />

            <ChatPanel
              messages={state.chatHistory}
              isSending={isChatSending}
              hasProvider={hasProvider}
              onSend={sendChatMessage}
              onApprove={approveProposal}
              onReject={rejectProposal}
              onClear={clearChat}
            />
          </>
        )}
      </main>
      <VersionHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        versions={state.versions}
        currentVersionId={state.currentVersionId}
        onCheckout={checkoutVersion}
      />
      {showResetConfirm && (
        <ConfirmModal
          title="Reset current session?"
          message={
            session && (session.events.length > 0 || (session.versions?.length ?? 0) > 0)
              ? "The current session will be saved to 'Saved sessions' and the side panel will start fresh. You can open it again later."
              : 'This will clear the current session and start fresh.'
          }
          confirmLabel="Reset"
          danger
          onConfirm={handleConfirmReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
      {showSessionsManager && (
        <SessionsManagerModal
          currentSession={session}
          onOpen={handleOpenArchivedSession}
          onClose={() => setShowSessionsManager(false)}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
