import React from 'react';
import type { DownloadAction } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';

interface DownloadBodyProps {
  action: DownloadAction;
  onChange: (next: Partial<DownloadAction>) => void;
  errors: Record<string, string>;
}

const TRIGGER_OPTIONS = [
  { value: 'click', label: 'Click element' },
  { value: 'navigation', label: 'Navigation' },
];

export function DownloadBody({ action, onChange, errors }: DownloadBodyProps) {
  return (
    <div>
      <SelectField
        label="Trigger"
        value={action.trigger}
        onChange={(trigger) => onChange({ trigger: trigger as DownloadAction['trigger'] })}
        options={TRIGGER_OPTIONS}
        required
        error={errors['trigger']}
      />

      <TextField
        label="Output directory"
        value={action.outputDir ?? ''}
        onChange={(outputDir) => onChange({ outputDir: outputDir || undefined })}
        placeholder="./downloads"
        hint="Overrides automation-level download directory"
        error={errors['outputDir']}
      />

      <TextField
        label="Expected filename"
        value={action.expectedFilename ?? ''}
        onChange={(expectedFilename) =>
          onChange({ expectedFilename: expectedFilename || undefined })
        }
        placeholder="report-*.pdf"
        hint="Glob pattern for logging only; does not filter actual downloads"
        error={errors['expectedFilename']}
      />
    </div>
  );
}
