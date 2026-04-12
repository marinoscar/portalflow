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
   * Replaces all {{varName}} placeholders in the template string with
   * the corresponding variable value from the context. Placeholders that
   * have no matching variable are left as-is.
   */
  resolveTemplate(template: string): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      const trimmed = key.trim();
      return this.variables.get(trimmed) ?? `{{${trimmed}}}`;
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
