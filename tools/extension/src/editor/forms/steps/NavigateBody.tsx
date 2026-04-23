import React from 'react';
import type { NavigateAction } from '@portalflow/schema';
import { TextField } from '../fields/TextField';
import { TemplateHint } from '../fields/TemplateHint';

interface NavigateBodyProps {
  action: NavigateAction;
  onChange: (next: Partial<NavigateAction>) => void;
  errors: Record<string, string>;
}

export function NavigateBody({ action, onChange, errors }: NavigateBodyProps) {
  return (
    <div>
      <TextField
        label="URL"
        value={action.url}
        onChange={(url) => onChange({ url })}
        placeholder="https://example.com"
        required
        error={errors['url']}
      />
      <TemplateHint />
    </div>
  );
}
