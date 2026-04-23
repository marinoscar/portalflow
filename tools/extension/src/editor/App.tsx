import './editor.css';

export function App() {
  return (
    <div className="editor-root">
      <header className="editor-toolbar">
        <div className="editor-toolbar-title">
          <h1>PortalFlow Automation Editor</h1>
        </div>
        <div className="editor-toolbar-actions">
          <button className="btn-secondary" type="button" disabled title="Upload automation JSON (Ctrl+O)">
            &#8593; Upload
          </button>
          <button className="btn-secondary" type="button" disabled title="Download automation JSON (Ctrl+S)">
            &#8595; Download
          </button>
          <button className="btn-secondary" type="button" disabled title="New automation">
            &#10011; New
          </button>
          <button className="btn-secondary" type="button" disabled title="Validate automation against schema">
            &#10003; Validate
          </button>
        </div>
      </header>

      <div className="editor-panes">
        <aside className="editor-pane editor-pane--outline">
          <div className="pane-header">
            <span className="pane-title">Outline</span>
          </div>
          <div className="pane-body">
            <p className="pane-placeholder">No automation loaded</p>
          </div>
        </aside>

        <main className="editor-pane editor-pane--form">
          <div className="pane-header">
            <span className="pane-title">Form Editor</span>
          </div>
          <div className="pane-body">
            <p className="pane-placeholder">Select a node from the outline to edit it</p>
          </div>
        </main>

        <aside className="editor-pane editor-pane--preview">
          <div className="pane-header">
            <span className="pane-title">JSON Preview</span>
          </div>
          <div className="pane-body">
            <p className="pane-placeholder">JSON output will appear here</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
