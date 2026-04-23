import { useState } from 'react';
import type { Automation } from '@portalflow/schema';
import type { ValidationResult } from '../state/editor-state';
import { automationToJson } from '../../converter/automation-to-json';

interface JsonPreviewProps {
  automation: Automation;
  validation: ValidationResult;
}

export function JsonPreview({ automation, validation }: JsonPreviewProps) {
  const [copyLabel, setCopyLabel] = useState('Copy');

  // When valid, use the canonical automationToJson output.
  // When invalid, fall back to raw JSON.stringify so the user can still see
  // their in-progress edits.
  let json: string;
  if (validation.success) {
    const result = automationToJson(automation);
    json = result.ok ? result.json : JSON.stringify(automation, null, 2);
  } else {
    json = JSON.stringify(automation, null, 2);
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopyLabel('Copied');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    } catch {
      setCopyLabel('Error');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    }
  };

  return (
    <div className="json-preview">
      <div className="json-preview-toolbar">
        <button className="btn-ghost json-copy-btn" type="button" onClick={handleCopy}>
          {copyLabel}
        </button>
      </div>
      <pre className="json-preview-raw">{json}</pre>
    </div>
  );
}
