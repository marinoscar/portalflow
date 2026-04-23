import { useReducer, useRef, useEffect, useState, useCallback } from 'react';
import './editor.css';
import { editorReducer, initialState, newEmptyAutomation } from './state/editor-state';
import { readAutomationFile, attachFileDrop } from './io/upload';
import { downloadAutomation } from './io/download';
import { AutomationSchema } from '@portalflow/schema';
import type { Automation } from '@portalflow/schema';

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
// App
// ---------------------------------------------------------------------------

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
    e.target.value = ''; // reset so same file can be re-selected
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
    // Cast raw as Automation (user acknowledges it may be invalid)
    const asAutomation = raw as Automation;
    dispatch({ type: 'LOAD', payload: asAutomation });
    // Mark dirty immediately since the schema is invalid
    dispatch({ type: 'UPDATE_METADATA', payload: {} });
    setUploadError(null);
  };

  // -------------------------------------------------------------------------
  // Derived display values
  // -------------------------------------------------------------------------

  const automationName = state.automation?.name ?? 'No automation loaded';
  const isValid = state.validation.success;
  const downloadDisabled = !state.automation || !isValid;

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
      <header className="editor-toolbar">
        <div className="editor-toolbar-title">
          <h1>
            PortalFlow Automation Editor
            {state.automation && (
              <span className="toolbar-name-separator"> &mdash; {automationName}</span>
            )}
            {state.dirty && <span className="dirty-dot" title="Unsaved changes">●</span>}
          </h1>
        </div>
        <div className="editor-toolbar-actions">
          <button
            className="btn-secondary"
            type="button"
            title="Upload automation JSON (Ctrl+O)"
            onClick={() => fileInputRef.current?.click()}
          >
            &#8593; Upload
          </button>
          <button
            className="btn-secondary"
            type="button"
            title={downloadDisabled ? 'Fix validation errors before downloading' : 'Download automation JSON (Ctrl+S)'}
            disabled={downloadDisabled}
            onClick={handleDownload}
          >
            &#8595; Download
          </button>
          <button
            className="btn-secondary"
            type="button"
            title="New automation"
            onClick={handleNew}
          >
            &#10011; New
          </button>
          <button
            className="btn-secondary"
            type="button"
            title="Validate automation against schema"
            disabled={!state.automation}
            onClick={handleValidate}
          >
            &#10003; Validate
          </button>
          {validateToast && (
            <span
              className={`validate-toast ${validateToast === 'All good' ? 'validate-toast--ok' : 'validate-toast--err'}`}
            >
              {validateToast}
            </span>
          )}
        </div>
      </header>

      {/* Three panes */}
      <div className="editor-panes">
        {/* Left: Outline */}
        <aside className="editor-pane editor-pane--outline">
          <div className="pane-header">
            <span className="pane-title">Outline</span>
          </div>
          <div className="pane-body">
            {state.automation ? (
              <p className="pane-placeholder">Outline coming in next phase</p>
            ) : (
              <p className="pane-placeholder">No automation loaded — upload a file or click New</p>
            )}
          </div>
        </aside>

        {/* Middle: Form */}
        <main className="editor-pane editor-pane--form">
          <div className="pane-header">
            <span className="pane-title">Form Editor</span>
          </div>
          <div className="pane-body">
            {state.automation ? (
              <p className="pane-placeholder">
                Select a node from the outline to edit it
              </p>
            ) : (
              <p className="pane-placeholder">Upload or create a new automation to get started</p>
            )}
          </div>
        </main>

        {/* Right: JSON Preview */}
        <aside className="editor-pane editor-pane--preview">
          <div className="pane-header">
            <span className="pane-title">JSON Preview</span>
          </div>
          <div className="pane-body">
            {state.automation ? (
              <pre className="json-preview-raw">
                {JSON.stringify(state.automation, null, 2)}
              </pre>
            ) : (
              <p className="pane-placeholder">JSON output will appear here</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
