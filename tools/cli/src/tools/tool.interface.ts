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

/**
 * Describes a single argument a tool command accepts.
 */
export interface ToolArgSpec {
  name: string;
  required: boolean;
  /** Short human-readable explanation shown to the LLM in the inventory block. */
  description: string;
}

/**
 * Describes one command exposed by a tool, including the args the LLM is
 * expected to pass and a plain-English description of what the result variable
 * contains.
 */
export interface ToolCommandSpec {
  command: string;
  description: string;
  args: ToolArgSpec[];
  /** Describes what the result context variable contains, e.g. "the OTP code". */
  resultDescription: string;
}

/**
 * The full inventory for a single tool: its canonical name, a short
 * description, and the list of commands it exposes. Returned by `describe()`
 * and injected into the LLM prompt so the model knows what it can call via
 * `tool_call` without the automation author having to spell it out in the goal.
 */
export interface ToolDescription {
  tool: string;
  description: string;
  commands: ToolCommandSpec[];
}

export interface Tool {
  readonly name: string;
  execute(command: string, args: Record<string, string>): Promise<ToolResult>;
  /**
   * Returns a machine-readable description of the tool's command surface.
   * Used by the runner to build the "Tools available in this run" block
   * injected into the LLM prompt on every aiscope iteration.
   */
  describe(): ToolDescription;
}
