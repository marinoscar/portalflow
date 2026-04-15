import pc from 'picocolors';
import type { Step } from '@portalflow/schema';
import type { RunResult } from './run-context.js';

/**
 * Terminal owner for an automation run. The presenter prints a compact
 * high-signal stream — one block per step, aiscope decisions nested
 * underneath, tool/extract outputs inline, and a one-line summary at
 * the end — while the noisy pino logger is redirected to a file so
 * retries, browser mechanics, provider telemetry, input resolution,
 * and other internals stay out of the user's view.
 *
 * The `enabled` flag is the `--verbose` escape hatch. When the user
 * opts into verbose mode, pino prints to stdout as before and this
 * presenter becomes a silent no-op so the two outputs don't interleave.
 *
 * The presenter is a plain class with no event emitter — call sites
 * invoke methods directly. That keeps the wiring obvious: every new
 * presenter method corresponds to a concrete event in one known place
 * in the runner or step executor.
 */

export type StepStatus = 'success' | 'skipped' | 'failed';

export class RunPresenter {
  private startedAt = 0;
  private llmCalls = 0;
  private llmInputTokens = 0;
  private llmOutputTokens = 0;
  private currentAiScope:
    | { stepId: string; iteration: number; maxIterations: number; iterationCount: number }
    | undefined;

  constructor(
    private readonly enabled: boolean,
    private readonly logFilePath: string,
  ) {}

  /** True when the presenter is writing to stdout. Callers can use this
   *  to suppress their own duplicate summary lines in verbose mode. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  // ---------------------------------------------------------------------
  // Run-level
  // ---------------------------------------------------------------------

  runStart(name: string, totalSteps: number): void {
    this.startedAt = Date.now();
    this.line('');
    this.line(
      pc.bold(pc.cyan('▶ ')) +
        pc.bold(name) +
        pc.dim(`  (${totalSteps} step${totalSteps === 1 ? '' : 's'})`),
    );
    this.line('');
  }

  runEnd(result: RunResult): void {
    const durationMs = result.completedAt.getTime() - result.startedAt.getTime();
    this.line(pc.dim('─'.repeat(60)));
    if (result.success) {
      this.line(
        pc.green('✓ complete') +
          '  ' +
          pc.dim(`${result.stepsCompleted}/${result.stepsTotal} steps`) +
          '  ' +
          pc.dim(this.formatDuration(durationMs)),
      );
    } else {
      this.line(
        pc.red('✗ failed') +
          '  ' +
          pc.dim(`${result.stepsCompleted}/${result.stepsTotal} steps`) +
          '  ' +
          pc.dim(this.formatDuration(durationMs)),
      );
      if (result.errors.length > 0) {
        for (const e of result.errors) {
          this.line('  ' + pc.red('· ') + pc.red(`${e.stepId}: `) + e.message);
        }
      }
    }
    if (this.llmCalls > 0) {
      const tokens = this.llmInputTokens + this.llmOutputTokens;
      this.line(
        pc.dim(
          `  ${this.llmCalls} LLM call${this.llmCalls === 1 ? '' : 's'} · ${tokens.toLocaleString()} tokens`,
        ),
      );
    }
    this.line(pc.dim(`  log: ${this.logFilePath}`));
    this.line('');
  }

  /** Fatal error before/outside a step (file read error, schema
   *  validation failure, etc.). Prints a short message and points at
   *  the log file. */
  runFatal(err: unknown): void {
    this.line('');
    this.line(
      pc.red('✗ run failed: ') + pc.red(err instanceof Error ? err.message : String(err)),
    );
    this.line(pc.dim(`  log: ${this.logFilePath}`));
    this.line('');
  }

  // ---------------------------------------------------------------------
  // Step-level
  // ---------------------------------------------------------------------

  stepStart(step: Step, index: number, total: number): void {
    const header =
      pc.cyan('▸ ') +
      pc.dim(`${index + 1}/${total}  `) +
      pc.bold(step.type.padEnd(9)) +
      pc.dim(step.id);
    this.line(header);
    const label = step.name || step.description;
    if (label) this.line('  ' + pc.dim(label));
  }

  stepEnd(step: Step, durationMs: number, status: StepStatus, error?: string): void {
    const ms = this.formatDuration(durationMs);
    const suffix = this.consumeAiScopeSuffix();
    if (status === 'success') {
      this.line('  ' + pc.green('✓ ') + pc.dim(ms) + suffix);
    } else if (status === 'skipped') {
      const reason = error ? pc.dim(` — ${this.truncate(error, 120)}`) : '';
      this.line('  ' + pc.yellow('↷ skipped ') + pc.dim(ms) + reason);
    } else {
      this.line('  ' + pc.red('✗ failed ') + pc.dim(ms));
      if (error) this.line('  ' + pc.red(this.truncate(error, 240)));
    }
    this.line('');
    // Discard in-step state for the next step.
    this.currentAiScope = undefined;
    void step;
  }

  // ---------------------------------------------------------------------
  // aiscope-level
  // ---------------------------------------------------------------------

  aiscopeStart(stepId: string, maxIterations: number): void {
    this.currentAiScope = { stepId, iteration: 0, maxIterations, iterationCount: 0 };
  }

  aiscopeIteration(iteration: number): void {
    if (this.currentAiScope) {
      this.currentAiScope.iteration = iteration;
      this.currentAiScope.iterationCount = iteration;
    }
  }

  aiscopeDecision(action: string, selector: string | undefined, reasoning: string): void {
    const itr =
      this.currentAiScope !== undefined
        ? pc.dim(`[${this.currentAiScope.iteration}/${this.currentAiScope.maxIterations}] `)
        : '';
    const actionPart = pc.magenta(action.padEnd(8));
    const selPart = selector ? ' ' + pc.cyan(selector) : '';
    const reason = reasoning ? pc.dim(' — ' + this.truncate(reasoning, 100)) : '';
    this.line('  ' + pc.dim('🤖 ') + itr + actionPart + selPart + reason);
  }

  aiscopeGoalReached(durationMs: number, iteration: number): void {
    if (this.currentAiScope) this.currentAiScope.iterationCount = iteration;
    this.line(
      '  ' +
        pc.green('✓ goal reached ') +
        pc.dim(`(${iteration} iter, ${this.formatDuration(durationMs)})`),
    );
  }

  /** Called from stepEnd to build a parenthetical with aiscope stats
   *  for successful aiscope steps so the step's ✓ line shows more
   *  context in one place. */
  private consumeAiScopeSuffix(): string {
    if (!this.currentAiScope || this.currentAiScope.iterationCount === 0) return '';
    const iters = this.currentAiScope.iterationCount;
    return pc.dim(`  (${iters} iter${iters === 1 ? '' : 's'})`);
  }

  // ---------------------------------------------------------------------
  // Inline results
  // ---------------------------------------------------------------------

  toolCallStart(tool: string, command: string): void {
    this.line('  ' + pc.magenta('⚙ ') + pc.bold(`${tool} ${command}`));
  }

  toolCallResult(outputName: string | undefined, value: unknown): void {
    if (!outputName) return;
    const preview = this.previewValue(value, 100);
    this.line('    ' + pc.dim('→ ') + pc.cyan(outputName) + pc.dim(' = ') + pc.dim(preview));
  }

  extractResult(outputName: string, value: unknown): void {
    const preview = this.previewValue(value, 120);
    this.line('  ' + pc.dim('→ ') + pc.cyan(outputName) + pc.dim(' = ') + pc.dim(preview));
  }

  // ---------------------------------------------------------------------
  // LLM telemetry
  // ---------------------------------------------------------------------

  llmCall(inputTokens?: number, outputTokens?: number): void {
    this.llmCalls += 1;
    if (typeof inputTokens === 'number') this.llmInputTokens += inputTokens;
    if (typeof outputTokens === 'number') this.llmOutputTokens += outputTokens;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private line(text: string): void {
    if (!this.enabled) return;
    process.stdout.write(text + '\n');
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m${s}s`;
  }

  private truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  private previewValue(value: unknown, max: number): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return this.truncate(value, max);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return this.truncate(JSON.stringify(value), max);
    } catch {
      return this.truncate(String(value), max);
    }
  }
}
