/**
 * In-memory checkpoint store for step-boundary reconnect recovery.
 *
 * When the Chrome extension disconnects between steps, the AutomationRunner
 * records the last successfully-completed step here. If the extension
 * reconnects within the 30-second window, the run resumes from the next step.
 *
 * No file persistence — v1 assumes the CLI process owns the run lifecycle.
 * If the CLI crashes, the run is lost (acceptable per the plan's non-goals).
 */

import type { RunContext } from './run-context.js';

// ---------------------------------------------------------------------------
// Checkpoint shape
// ---------------------------------------------------------------------------

export interface Checkpoint {
  /** UUID identifying the automation run. */
  runId: string;
  /** Zero-based index of the last step that completed successfully. */
  lastCompletedStepIndex: number;
  /** Structured clone of the RunContext state at checkpoint time. */
  contextSnapshot: unknown;
  /** Unix timestamp (ms) when this checkpoint was recorded. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Context snapshot shape
// ---------------------------------------------------------------------------

/** Fields of RunContext that are safe to snapshot and restore. */
export interface RunContextSnapshot {
  variables: Array<[string, string]>;
  outputs: Record<string, unknown>;
  artifacts: string[];
  errors: Array<{ stepId: string; stepName: string; message: string; timestamp: string }>;
  stepsCompleted: number;
}

// ---------------------------------------------------------------------------
// Snapshot / restore helpers
// ---------------------------------------------------------------------------

/**
 * Capture a structured clone of the RunContext fields that are safe to
 * snapshot: extracted variables, step results, outputs, artifacts, errors,
 * and the completed-step count.
 *
 * Deliberately excludes transient handles (loggers, file streams, LLM
 * sessions) and internal Map references — only plain-data fields are cloned.
 */
export function snapshotRunContext(ctx: RunContext): RunContextSnapshot {
  return structuredClone({
    variables: [...ctx.variables.entries()],
    outputs: ctx.outputs,
    artifacts: ctx.artifacts,
    errors: ctx.errors.map((e) => ({
      stepId: e.stepId,
      stepName: e.stepName,
      message: e.message,
      timestamp: e.timestamp.toISOString(),
    })),
    stepsCompleted: (ctx as unknown as { stepsCompleted: number }).stepsCompleted,
  });
}

/**
 * Write the snapshot fields back into a live RunContext instance.
 * Called on reconnect, before the step loop resumes from the checkpoint index.
 *
 * Only overwrites fields included in the snapshot — does not touch transient
 * state (logger, systemFunctions, automationName, startedAt, runId).
 */
export function restoreRunContext(ctx: RunContext, snapshot: unknown): void {
  const s = snapshot as RunContextSnapshot;

  // Restore variables map.
  ctx.variables.clear();
  for (const [k, v] of s.variables) {
    ctx.variables.set(k, v);
  }

  // Restore plain-data fields by direct assignment (they are declared
  // readonly on the type but the snapshot write path uses the live instance
  // through the mutable interface).
  const mutable = ctx as unknown as {
    outputs: Record<string, unknown>;
    artifacts: string[];
    errors: Array<{ stepId: string; stepName: string; message: string; timestamp: Date }>;
    stepsCompleted: number;
  };

  // Clear and repopulate outputs.
  for (const key of Object.keys(mutable.outputs)) {
    delete mutable.outputs[key];
  }
  Object.assign(mutable.outputs, s.outputs);

  // Replace artifacts array in-place.
  mutable.artifacts.length = 0;
  mutable.artifacts.push(...s.artifacts);

  // Replace errors array in-place (re-hydrate Date from ISO string).
  mutable.errors.length = 0;
  mutable.errors.push(
    ...s.errors.map((e) => ({
      stepId: e.stepId,
      stepName: e.stepName,
      message: e.message,
      timestamp: new Date(e.timestamp),
    })),
  );

  // Restore stepsCompleted counter.
  mutable.stepsCompleted = s.stepsCompleted;
}

// ---------------------------------------------------------------------------
// CheckpointStore
// ---------------------------------------------------------------------------

/** Default reconnect window used by isStale. */
export const DEFAULT_RECONNECT_WINDOW_MS = 30_000;

export class CheckpointStore {
  private readonly store = new Map<string, Checkpoint>();

  /**
   * Record (or overwrite) the checkpoint for a run.
   * Called after every successfully-completed step.
   */
  record(checkpoint: Checkpoint): void {
    this.store.set(checkpoint.runId, checkpoint);
  }

  /**
   * Retrieve the most recent checkpoint for a run.
   * Returns `undefined` if no checkpoint has been recorded yet.
   */
  get(runId: string): Checkpoint | undefined {
    return this.store.get(runId);
  }

  /**
   * Remove the checkpoint for a run.
   * Called on successful completion so memory is not leaked.
   */
  clear(runId: string): void {
    this.store.delete(runId);
  }

  /**
   * Returns `true` if the checkpoint for `runId` is older than `maxAgeMs`,
   * or if no checkpoint exists. Used to decide whether to abort vs. wait.
   */
  isStale(runId: string, maxAgeMs: number): boolean {
    const cp = this.store.get(runId);
    if (!cp) return true;
    return Date.now() - cp.timestamp > maxAgeMs;
  }
}
