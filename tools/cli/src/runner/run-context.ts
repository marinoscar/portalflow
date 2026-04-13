import type pino from 'pino';

export interface RunResult {
  success: boolean;
  startedAt: Date;
  completedAt: Date;
  stepsCompleted: number;
  stepsTotal: number;
  outputs: Record<string, unknown>;
  artifacts: string[];
  errors: RunError[];
}

export interface RunError {
  stepId: string;
  stepName: string;
  message: string;
  timestamp: Date;
}

export class RunContext {
  readonly variables: Map<string, string> = new Map();
  readonly outputs: Record<string, unknown> = {};
  readonly artifacts: string[] = [];
  readonly errors: RunError[] = [];
  readonly startedAt = new Date();
  private stepsCompleted = 0;

  constructor(
    readonly automationName: string,
    readonly logger: pino.Logger,
  ) {}

  setVariable(name: string, value: string): void {
    this.variables.set(name, value);
  }

  getVariable(name: string): string | undefined {
    return this.variables.get(name);
  }

  /**
   * Replaces all {{varName}} placeholders in the template string with the
   * corresponding variable value from the context.
   *
   * Supports an inline default via colon syntax: {{varName:defaultValue}}.
   * The split is on the FIRST colon only, so the default may itself contain
   * colons (e.g., a URL like "http://localhost:3000/api").
   *
   * - If the variable is set, its value is used regardless of any default.
   * - If the variable is unset and a default is provided (even empty string),
   *   the default is used.
   * - If the variable is unset and there is no colon in the expression, the
   *   placeholder is left as-is (legacy behaviour).
   */
  resolveTemplate(template: string): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
      const trimmed = expr.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx >= 0) {
        const varName = trimmed.slice(0, colonIdx).trim();
        // Locate the colon in the original (un-trimmed) expr so that
        // whitespace after the colon is preserved exactly as written.
        const colonIdxInExpr = expr.indexOf(':');
        const defaultValue = expr.slice(colonIdxInExpr + 1);
        const value = this.variables.get(varName);
        return value !== undefined ? value : defaultValue;
      }
      const value = this.variables.get(trimmed);
      return value ?? `{{${trimmed}}}`;
    });
  }

  addOutput(name: string, value: unknown): void {
    this.outputs[name] = value;
  }

  addArtifact(path: string): void {
    this.artifacts.push(path);
  }

  addError(stepId: string, stepName: string, message: string): void {
    this.errors.push({ stepId, stepName, message, timestamp: new Date() });
  }

  incrementCompleted(): void {
    this.stepsCompleted += 1;
  }

  toResult(stepsTotal: number): RunResult {
    return {
      success: this.errors.length === 0,
      startedAt: this.startedAt,
      completedAt: new Date(),
      stepsCompleted: this.stepsCompleted,
      stepsTotal,
      outputs: { ...this.outputs },
      artifacts: [...this.artifacts],
      errors: [...this.errors],
    };
  }
}
