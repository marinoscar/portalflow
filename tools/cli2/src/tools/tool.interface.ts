export interface ToolResult {
  success: boolean;
  output: string;   // the extracted value (OTP code, secret value, etc.)
  fields?: Record<string, string>; // optional multi-field result (e.g. vaultcli secret values)
  raw?: string;     // raw stdout from the tool
  error?: string;
}

export interface ToolExecutionOptions {
  timeout?: number; // ms, default 60000
  cwd?: string;
}

export interface Tool {
  readonly name: string;
  execute(command: string, args: Record<string, string>): Promise<ToolResult>;
}
