import type { Automation } from '@portalflow/schema';
import type { ValidationResult } from '../state/editor-state';

interface ToolbarProps {
  automation: Automation | null;
  dirty: boolean;
  validation: ValidationResult;
  validateToast: string | null;
  onUpload: () => void;
  onDownload: () => void;
  onNew: () => void;
  onValidate: () => void;
}

export function Toolbar({
  automation,
  dirty,
  validation,
  validateToast,
  onUpload,
  onDownload,
  onNew,
  onValidate,
}: ToolbarProps) {
  const isValid = validation.success;
  const downloadDisabled = !automation || !isValid;

  return (
    <header className="editor-toolbar">
      <div className="editor-toolbar-title">
        <h1>
          PortalFlow Automation Editor
          {automation && (
            <span className="toolbar-name-separator"> &mdash; {automation.name}</span>
          )}
          {dirty && <span className="dirty-dot" title="Unsaved changes">●</span>}
        </h1>
      </div>
      <div className="editor-toolbar-actions">
        <button
          className="btn-secondary"
          type="button"
          title="Upload automation JSON (Ctrl+O)"
          onClick={onUpload}
        >
          &#8593; Upload
        </button>
        <button
          className="btn-secondary"
          type="button"
          title={
            downloadDisabled
              ? 'Fix validation errors before downloading'
              : 'Download automation JSON (Ctrl+S)'
          }
          disabled={downloadDisabled}
          onClick={onDownload}
        >
          &#8595; Download
        </button>
        <button
          className="btn-secondary"
          type="button"
          title="New automation"
          onClick={onNew}
        >
          &#10011; New
        </button>
        <button
          className="btn-secondary"
          type="button"
          title="Validate automation against schema"
          disabled={!automation}
          onClick={onValidate}
        >
          &#10003; Validate
        </button>
        {validateToast && (
          <span
            className={`validate-toast ${
              validateToast === 'All good' ? 'validate-toast--ok' : 'validate-toast--err'
            }`}
          >
            {validateToast}
          </span>
        )}
      </div>
    </header>
  );
}
