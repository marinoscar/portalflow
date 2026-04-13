import { useState } from 'react';
import type { Automation } from '@portalflow/schema';
import { automationToJson, slugify } from '../../converter/automation-to-json';

interface Props {
  automation: Automation;
}

export function ExportBar({ automation }: Props) {
  const [errors, setErrors] = useState<string[]>([]);

  const handleExport = async () => {
    const result = automationToJson(automation);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);

    const blob = new Blob([result.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `${slugify(automation.name)}.json`,
      saveAs: true,
    });
    // Revoke the URL after a delay to give Chrome time to consume it
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <section className="card">
      <h2 className="card-title">Export</h2>
      <button className="btn-primary" onClick={handleExport}>
        Download automation JSON
      </button>
      {errors.length > 0 && (
        <div className="error-box">
          <strong>Cannot export &mdash; validation errors:</strong>
          <ul>
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
