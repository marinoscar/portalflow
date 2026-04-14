import { useState } from 'react';
import type { Automation } from '@portalflow/schema';
import type { RecordingSession } from '../../shared/types';
import { automationToJson, slugify } from '../../converter/automation-to-json';
import { exportSession } from '../services/session-export';

interface Props {
  automation: Automation;
  session: RecordingSession | null;
  currentVersionId: string | null;
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ExportBar({ automation, session, currentVersionId }: Props) {
  const [errors, setErrors] = useState<string[]>([]);

  const handleExportJson = async () => {
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
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleExportSession = async () => {
    if (!session) {
      setErrors(['No active session to export.']);
      return;
    }
    // Still validate the automation first — session export would otherwise
    // succeed even if the head automation is broken, which is confusing.
    const result = automationToJson(automation);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);

    try {
      const blob = exportSession(session, automation, currentVersionId);
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url,
        filename: `portalflow-session-${slugify(automation.name)}-${todayStamp()}.zip`,
        saveAs: true,
      });
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setErrors([`Session export failed: ${String(err)}`]);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Export</h2>
      <div className="export-buttons">
        <button className="btn-primary" onClick={handleExportSession} type="button">
          Export session (.zip)
        </button>
        <button className="btn-secondary" onClick={handleExportJson} type="button">
          Export automation (.json)
        </button>
      </div>
      <p className="muted export-hint">
        The zip includes the current automation, the raw original recording,
        every committed version, every unique HTML snapshot, and the AI chat
        history. Use the .json export for the minimum the CLI needs to run.
      </p>
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
