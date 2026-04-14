import { randomUUID } from 'node:crypto';
import type pino from 'pino';

// ---------------------------------------------------------------------------
// System template function helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const DAY_NAMES_SHORT = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

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
  /**
   * Stable, unique id for this run. Generated once when the context is
   * constructed and exposed via the `{{$runId}}` template function.
   */
  readonly runId: string = randomUUID();
  private stepsCompleted = 0;
  /**
   * Built-in template functions invoked via `{{$name}}` syntax. Stable
   * values close over runId/startedAt/automationName captured at
   * construction. Date/time and identifier helpers compute fresh values
   * on every call so two `{{$uuid}}` references produce different ids
   * and a long-running automation crossing midnight gets the new date.
   */
  private readonly systemFunctions: Map<string, () => string>;

  constructor(
    readonly automationName: string,
    readonly logger: pino.Logger,
  ) {
    const stableRunId = this.runId;
    const stableStartedAt = this.startedAt;
    const stableAutomationName = this.automationName;

    this.systemFunctions = new Map<string, () => string>([
      // --- Date (current, fresh on each call) ---
      ['$date',           () => toIsoDate(new Date())],
      ['$year',           () => String(new Date().getFullYear())],
      ['$yearShort',      () => String(new Date().getFullYear()).slice(-2)],
      ['$month',          () => String(new Date().getMonth() + 1)],
      ['$month0',         () => pad2(new Date().getMonth() + 1)],
      ['$monthName',      () => MONTH_NAMES[new Date().getMonth()]],
      ['$monthNameShort', () => MONTH_NAMES_SHORT[new Date().getMonth()]],
      ['$day',            () => String(new Date().getDate())],
      ['$day0',           () => pad2(new Date().getDate())],
      ['$dayOfWeek',      () => DAY_NAMES[new Date().getDay()]],
      ['$dayOfWeekShort', () => DAY_NAMES_SHORT[new Date().getDay()]],

      // --- Time (current, fresh on each call) ---
      ['$hour',         () => pad2(new Date().getHours())],
      ['$hour12',       () => pad2(((new Date().getHours() + 11) % 12) + 1)],
      ['$minute',       () => pad2(new Date().getMinutes())],
      ['$second',       () => pad2(new Date().getSeconds())],
      ['$ampm',         () => (new Date().getHours() < 12 ? 'AM' : 'PM')],
      ['$time',         () => {
        const d = new Date();
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
      }],
      ['$isoDateTime',  () => new Date().toISOString()],
      ['$timestamp',    () => String(Date.now())],
      ['$timestampSec', () => String(Math.floor(Date.now() / 1000))],

      // --- Relative dates (fresh on each call) ---
      ['$yesterday', () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return toIsoDate(d);
      }],
      ['$tomorrow', () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return toIsoDate(d);
      }],
      ['$firstOfMonth', () => {
        const d = new Date();
        return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
      }],
      ['$lastOfMonth', () => {
        const d = new Date();
        return toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      }],

      // --- Run metadata (stable for the lifetime of this RunContext) ---
      ['$runId',          () => stableRunId],
      ['$automationName', () => stableAutomationName],
      ['$startedAt',      () => stableStartedAt.toISOString()],

      // --- Identifier helpers (fresh on each call) ---
      ['$uuid',  () => randomUUID()],
      ['$nonce', () => Math.random().toString(36).slice(2, 10)],
    ]);
  }

  setVariable(name: string, value: string): void {
    this.variables.set(name, value);
  }

  getVariable(name: string): string | undefined {
    return this.variables.get(name);
  }

  deleteVariable(name: string): void {
    this.variables.delete(name);
  }

  /**
   * Replaces all {{varName}} placeholders in the template string with the
   * corresponding variable value from the context.
   *
   * Supports two forms:
   *
   * 1. **User variables** — `{{varName}}` and `{{varName:defaultValue}}`.
   *    The variable is looked up in the context map. If unset and a colon
   *    default is provided (even empty), the default is used. If unset
   *    with no default, the placeholder is left as-is (legacy behaviour).
   *    The split happens on the FIRST colon only so defaults may contain
   *    colons (e.g. URLs like "http://localhost:3000/api").
   *
   * 2. **System functions** — `{{$name}}`. Expressions starting with `$`
   *    are dispatched to the built-in `systemFunctions` registry instead
   *    of the variables map. System functions ALWAYS resolve, so any
   *    `:default` suffix is silently ignored. Unknown function names
   *    fall through to the literal-placeholder behaviour for consistency
   *    with unknown variables.
   *
   * See section 13 of `docs/AUTOMATION-JSON-SPEC.md` for the full list
   * of system functions.
   */
  resolveTemplate(template: string): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
      const trimmed = expr.trim();

      // System functions take priority and never honor a default.
      if (trimmed.startsWith('$')) {
        const colonIdx = trimmed.indexOf(':');
        const fnName = colonIdx >= 0 ? trimmed.slice(0, colonIdx).trim() : trimmed;
        const fn = this.systemFunctions.get(fnName);
        if (fn) return fn();
        return `{{${trimmed}}}`; // unknown function — leave literal
      }

      // Existing variable + default behavior (unchanged)
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
