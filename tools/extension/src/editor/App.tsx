import { useReducer, useRef, useEffect, useState, useCallback } from 'react';
import './editor.css';
import { editorReducer, initialState, newEmptyAutomation } from './state/editor-state';
import { readAutomationFile, attachFileDrop } from './io/upload';
import { downloadAutomation } from './io/download';
import { AutomationSchema } from '@portalflow/schema';
import { Toolbar } from './components/Toolbar';
import { Outline } from './components/Outline';
import { JsonPreview } from './components/JsonPreview';
import { IssuesPanel } from './components/IssuesPanel';
import { parseNodeId, getStepAtPath, getFunctionStepAtPath } from './state/selection';
import { MetadataForm } from './forms/MetadataForm';
import { InputForm } from './forms/InputForm';
import { FunctionForm } from './forms/FunctionForm';
import { StepForm } from './forms/StepForm';
import type { EditorState, EditorAction } from './state/editor-state';

// ---------------------------------------------------------------------------
// Upload-error modal
// ---------------------------------------------------------------------------

interface UploadErrorModalProps {
  errors: string[];
  raw: unknown | undefined;
  onClose: () => void;
  onLoadAnyway: ((raw: unknown) => void) | null;
}

function UploadErrorModal({ errors, raw, onClose, onLoadAnyway }: UploadErrorModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <strong>Upload failed</strong>
          <button className="btn-ghost modal-close" onClick={onClose} type="button">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-error-intro">The file could not be loaded:</p>
          <ul className="modal-error-list">
            {errors.slice(0, 10).map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
            {errors.length > 10 && (
              <li className="modal-error-more">…and {errors.length - 10} more issues</li>
            )}
          </ul>
        </div>
        <div className="modal-footer">
          {onLoadAnyway && raw !== undefined && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => onLoadAnyway(raw)}
            >
              Load anyway (schema errors visible)
            </button>
          )}
          <button className="btn-primary" type="button" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormPane — routes selected node to the correct form
// ---------------------------------------------------------------------------

function FormPane({ state, dispatch }: { state: EditorState; dispatch: React.Dispatch<EditorAction> }) {
  const { automation, selectedNodeId, validation } = state;

  if (!automation) {
    return <p className="pane-placeholder">Upload or create a new automation to get started</p>;
  }

  const node = parseNodeId(selectedNodeId);

  switch (node.kind) {
    case 'none':
      return (
        <p className="pane-placeholder">Select an item in the outline to edit it</p>
      );

    case 'metadata':
      return (
        <MetadataForm automation={automation} dispatch={dispatch} validation={validation} />
      );

    case 'input': {
      const input = automation.inputs[node.index];
      if (!input) return <p className="pane-placeholder">Input not found</p>;
      return (
        <InputForm
          input={input}
          index={node.index}
          dispatch={dispatch}
          validation={validation}
        />
      );
    }

    case 'step': {
      const step = getStepAtPath(automation, node.path);
      if (!step) return <p className="pane-placeholder">Step not found</p>;
      return (
        <StepForm
          step={step}
          path={node.path}
          dispatch={dispatch}
          validation={validation}
          automation={automation}
        />
      );
    }

    case 'function': {
      const fn = (automation.functions ?? [])[node.index];
      if (!fn) return <p className="pane-placeholder">Function not found</p>;

      if (node.stepPath !== undefined) {
        const step = getFunctionStepAtPath(automation, node.index, node.stepPath);
        if (!step) return <p className="pane-placeholder">Step not found</p>;
        return (
          <StepForm
            step={step}
            path={node.stepPath}
            functionIndex={node.index}
            dispatch={dispatch}
            validation={validation}
            automation={automation}
          />
        );
      }

      return (
        <FunctionForm
          fn={fn}
          index={node.index}
          dispatch={dispatch}
          validation={validation}
        />
      );
    }
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

type RightTab = 'json' | 'issues';

export function App() {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Modal state for upload errors
  const [uploadError, setUploadError] = useState<{
    errors: string[];
    raw?: unknown;
    canLoadAnyway: boolean;
  } | null>(null);

  // Validate toast state
  const [validateToast, setValidateToast] = useState<string | null>(null);
  const validateToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Right pane tab
  const [rightTab, setRightTab] = useState<RightTab>('json');

  // -------------------------------------------------------------------------
  // File processing (shared between picker and drag-drop)
  // -------------------------------------------------------------------------

  const processFile = useCallback(async (file: File) => {
    const result = await readAutomationFile(file);
    if (result.ok) {
      dispatch({ type: 'LOAD', payload: result.data });
    } else {
      setUploadError({
        errors: result.errors,
        raw: result.raw,
        canLoadAnyway: result.stage === 'schema',
      });
    }
  }, []);

  // -------------------------------------------------------------------------
  // Drag-drop setup
  // -------------------------------------------------------------------------

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const cleanup = attachFileDrop(el, processFile);
    return cleanup;
  }, [processFile]);

  // -------------------------------------------------------------------------
  // Beforeunload guard
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.dirty]);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
      }
      if (meta && e.key === 's') {
        e.preventDefault();
        if (state.automation) {
          handleDownload();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.automation]);

  // -------------------------------------------------------------------------
  // Toolbar handlers
  // -------------------------------------------------------------------------

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await processFile(file);
  };

  const handleDownload = async () => {
    if (!state.automation) return;
    const result = await downloadAutomation(state.automation);
    if (result.ok) {
      dispatch({ type: 'MARK_CLEAN' });
    } else {
      setUploadError({ errors: result.errors, canLoadAnyway: false });
    }
  };

  const handleNew = () => {
    if (state.dirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Create a new automation anyway?',
      );
      if (!confirmed) return;
    }
    dispatch({ type: 'LOAD', payload: newEmptyAutomation() });
  };

  const handleValidate = () => {
    if (!state.automation) return;
    const result = AutomationSchema.safeParse(state.automation);
    const msg = result.success
      ? 'All good'
      : `${result.error.issues.length} issue${result.error.issues.length === 1 ? '' : 's'}`;

    setValidateToast(msg);
    if (validateToastTimerRef.current) clearTimeout(validateToastTimerRef.current);
    validateToastTimerRef.current = setTimeout(() => setValidateToast(null), 3000);
  };

  const handleLoadAnyway = (raw: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asAutomation = raw as any;
    dispatch({ type: 'LOAD', payload: asAutomation });
    // Mark dirty so the user knows edits are needed
    dispatch({ type: 'UPDATE_METADATA', payload: {} });
    setUploadError(null);
  };

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const issueCount = state.validation.success ? 0 : state.validation.error.issues.length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="editor-root" ref={rootRef}>
      {/* Hidden file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Upload error modal */}
      {uploadError && (
        <UploadErrorModal
          errors={uploadError.errors}
          raw={uploadError.raw}
          onClose={() => setUploadError(null)}
          onLoadAnyway={uploadError.canLoadAnyway ? handleLoadAnyway : null}
        />
      )}

      {/* Toolbar */}
      <Toolbar
        automation={state.automation}
        dirty={state.dirty}
        validation={state.validation}
        validateToast={validateToast}
        onUpload={() => fileInputRef.current?.click()}
        onDownload={handleDownload}
        onNew={handleNew}
        onValidate={handleValidate}
      />

      {/* Three panes */}
      <div className="editor-panes">
        {/* Left: Outline */}
        <aside className="editor-pane editor-pane--outline">
          <div className="pane-header">
            <span className="pane-title">Outline</span>
          </div>
          <div className="pane-body pane-body--outline">
            {state.automation ? (
              <Outline
                automation={state.automation}
                selectedNodeId={state.selectedNodeId}
                dispatch={dispatch}
              />
            ) : (
              <p className="pane-placeholder">
                No automation loaded — upload a file or click New
              </p>
            )}
          </div>
        </aside>

        {/* Middle: Form editor */}
        <main className="editor-pane editor-pane--form">
          <div className="pane-header">
            <span className="pane-title">Form Editor</span>
          </div>
          <div className="pane-body">
            <FormPane state={state} dispatch={dispatch} />
          </div>
        </main>

        {/* Right: JSON / Issues tabs */}
        <aside className="editor-pane editor-pane--preview">
          {/* Tab strip */}
          <div className="pane-header pane-header--tabs">
            <button
              className={`tab-btn ${rightTab === 'json' ? 'tab-btn--active' : ''}`}
              type="button"
              onClick={() => setRightTab('json')}
            >
              JSON
            </button>
            <button
              className={`tab-btn ${rightTab === 'issues' ? 'tab-btn--active' : ''}`}
              type="button"
              onClick={() => setRightTab('issues')}
            >
              Issues
              {issueCount > 0 && (
                <span className="tab-badge">{issueCount}</span>
              )}
            </button>
          </div>

          <div className="pane-body pane-body--preview">
            {state.automation ? (
              rightTab === 'json' ? (
                <JsonPreview
                  automation={state.automation}
                  validation={state.validation}
                />
              ) : (
                <IssuesPanel
                  validation={state.validation}
                  dispatch={dispatch}
                />
              )
            ) : (
              <p className="pane-placeholder">
                {rightTab === 'json'
                  ? 'JSON output will appear here'
                  : 'No automation loaded'}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
