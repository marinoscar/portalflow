import React from 'react';
import type { ToolCallAction } from '@portalflow/schema';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';
import { KeyValueList } from '../fields/KeyValueList';

interface ToolCallBodyProps {
  action: ToolCallAction;
  onChange: (next: Partial<ToolCallAction>) => void;
  errors: Record<string, string>;
}

type ToolName = 'smscli' | 'vaultcli';
type CommandName = 'otp-wait' | 'otp-latest' | 'otp-extract' | 'secrets-get';

const COMMANDS_BY_TOOL: Record<ToolName, { value: string; label: string }[]> = {
  vaultcli: [{ value: 'secrets-get', label: 'secrets-get' }],
  smscli: [
    { value: 'otp-wait', label: 'otp-wait' },
    { value: 'otp-latest', label: 'otp-latest' },
    { value: 'otp-extract', label: 'otp-extract' },
  ],
};

const TOOL_OPTIONS = [
  { value: 'smscli', label: 'smscli' },
  { value: 'vaultcli', label: 'vaultcli' },
];

function argsSuggestionHint(tool: ToolName, command: string): string {
  if (tool === 'vaultcli' && command === 'secrets-get') {
    return 'Suggested args: name (required), field (optional)';
  }
  if (tool === 'smscli' && command === 'otp-wait') {
    return 'Suggested args: sender, number, timeout, since, device (all optional)';
  }
  if (tool === 'smscli' && command === 'otp-latest') {
    return 'Suggested args: sender, number, timeout, since, device (all optional)';
  }
  if (tool === 'smscli' && command === 'otp-extract') {
    return 'Suggested arg: message (required)';
  }
  return '';
}

export function ToolCallBody({ action, onChange, errors }: ToolCallBodyProps) {
  const tool = action.tool as ToolName;
  const commandOptions = COMMANDS_BY_TOOL[tool] ?? COMMANDS_BY_TOOL['smscli'];
  const hint = argsSuggestionHint(tool, action.command);

  function handleToolChange(newTool: string) {
    const t = newTool as ToolName;
    const firstCommand = COMMANDS_BY_TOOL[t]?.[0]?.value ?? '';
    onChange({ tool: t, command: firstCommand });
  }

  return (
    <div>
      <SelectField
        label="Tool"
        value={action.tool}
        onChange={handleToolChange}
        options={TOOL_OPTIONS}
        required
        error={errors['tool']}
      />

      <SelectField
        label="Command"
        value={action.command}
        onChange={(command) => onChange({ command })}
        options={commandOptions}
        required
        error={errors['command']}
      />

      <KeyValueList
        label="Args"
        value={action.args ?? {}}
        onChange={(args) => onChange({ args: Object.keys(args).length ? args : undefined })}
        keyPlaceholder="arg name"
        valuePlaceholder="value"
        hint={hint}
      />

      <TextField
        label="Output name"
        value={action.outputName ?? ''}
        onChange={(outputName) => onChange({ outputName: outputName || undefined })}
        placeholder="myVariable"
        monospace
        hint={
          tool === 'vaultcli'
            ? 'Optional. For vaultcli/secrets-get with multiple fields, result is a record — reference individual fields as {{outputName.fieldName}}'
            : 'Optional. Reference as {{outputName}} in later steps'
        }
        error={errors['outputName']}
      />
    </div>
  );
}
