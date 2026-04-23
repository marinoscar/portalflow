/**
 * Unit tests for the in-memory CheckpointStore and RunContext
 * snapshot / restore helpers.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import pino from 'pino';
import {
  CheckpointStore,
  snapshotRunContext,
  restoreRunContext,
  DEFAULT_RECONNECT_WINDOW_MS,
  type Checkpoint,
} from '../checkpoint.js';
import { RunContext } from '../run-context.js';

const logger = pino({ level: 'silent' });

// ---------------------------------------------------------------------------
// CheckpointStore — basic CRUD
// ---------------------------------------------------------------------------

describe('CheckpointStore', () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = new CheckpointStore();
  });

  it('get() returns undefined for an unknown runId', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('record() then get() returns the stored checkpoint', () => {
    const cp: Checkpoint = {
      runId: 'run-1',
      lastCompletedStepIndex: 2,
      contextSnapshot: { variables: [], outputs: {}, artifacts: [], errors: [], stepsCompleted: 3 },
      timestamp: Date.now(),
    };
    store.record(cp);
    expect(store.get('run-1')).toStrictEqual(cp);
  });

  it('record() overwrites an existing checkpoint for the same runId', () => {
    const cp1: Checkpoint = {
      runId: 'run-1',
      lastCompletedStepIndex: 0,
      contextSnapshot: {},
      timestamp: 1000,
    };
    const cp2: Checkpoint = {
      runId: 'run-1',
      lastCompletedStepIndex: 1,
      contextSnapshot: {},
      timestamp: 2000,
    };

    store.record(cp1);
    store.record(cp2);

    const retrieved = store.get('run-1');
    expect(retrieved).toStrictEqual(cp2);
    expect(retrieved?.lastCompletedStepIndex).toBe(1);
  });

  it('clear() removes the checkpoint so get() returns undefined', () => {
    store.record({ runId: 'run-2', lastCompletedStepIndex: 3, contextSnapshot: {}, timestamp: Date.now() });
    store.clear('run-2');
    expect(store.get('run-2')).toBeUndefined();
  });

  it('clear() on unknown runId is a no-op (does not throw)', () => {
    expect(() => store.clear('ghost-run')).not.toThrow();
  });

  it('checkpoints for different runIds are independent', () => {
    store.record({ runId: 'run-a', lastCompletedStepIndex: 0, contextSnapshot: {}, timestamp: 1 });
    store.record({ runId: 'run-b', lastCompletedStepIndex: 5, contextSnapshot: {}, timestamp: 2 });

    expect(store.get('run-a')?.lastCompletedStepIndex).toBe(0);
    expect(store.get('run-b')?.lastCompletedStepIndex).toBe(5);

    store.clear('run-a');
    expect(store.get('run-a')).toBeUndefined();
    expect(store.get('run-b')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // isStale
  // ---------------------------------------------------------------------------

  describe('isStale()', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true for an unknown runId', () => {
      expect(store.isStale('unknown-run', 30_000)).toBe(true);
    });

    it('returns false when checkpoint is fresh', () => {
      vi.useFakeTimers();
      const now = Date.now();
      store.record({ runId: 'run-fresh', lastCompletedStepIndex: 0, contextSnapshot: {}, timestamp: now });
      // Advance by less than maxAgeMs
      vi.advanceTimersByTime(10_000);
      expect(store.isStale('run-fresh', 30_000)).toBe(false);
    });

    it('returns true when checkpoint is older than maxAgeMs', () => {
      vi.useFakeTimers();
      const now = Date.now();
      store.record({ runId: 'run-old', lastCompletedStepIndex: 0, contextSnapshot: {}, timestamp: now });
      vi.advanceTimersByTime(30_001);
      expect(store.isStale('run-old', 30_000)).toBe(true);
    });

    it('returns false exactly at maxAgeMs boundary (elapsed < maxAgeMs)', () => {
      vi.useFakeTimers();
      const now = Date.now();
      store.record({ runId: 'run-edge', lastCompletedStepIndex: 0, contextSnapshot: {}, timestamp: now });
      vi.advanceTimersByTime(30_000);
      // exactly 30 000 ms elapsed → NOT stale (> is used, not >=)
      expect(store.isStale('run-edge', 30_000)).toBe(false);
    });

    it('uses DEFAULT_RECONNECT_WINDOW_MS constant (30 000 ms)', () => {
      expect(DEFAULT_RECONNECT_WINDOW_MS).toBe(30_000);
    });
  });
});

// ---------------------------------------------------------------------------
// snapshotRunContext / restoreRunContext
// ---------------------------------------------------------------------------

describe('snapshotRunContext / restoreRunContext', () => {
  it('round-trips variables, outputs, artifacts, errors, stepsCompleted', () => {
    const ctx = new RunContext('test-automation', logger);

    // Populate some state.
    ctx.setVariable('user', 'alice');
    ctx.setVariable('token', 'secret-123');
    ctx.addOutput('pageTitle', 'Hello World');
    ctx.addArtifact('/tmp/screenshot.png');
    ctx.addError('step-1', 'Navigate', 'Navigation failed');
    ctx.incrementCompleted();
    ctx.incrementCompleted();
    ctx.recordStepOutcome('step-1', 'failed', 'Navigation failed');

    const snapshot = snapshotRunContext(ctx);

    // Restore into a fresh context.
    const ctx2 = new RunContext('test-automation', logger);
    restoreRunContext(ctx2, snapshot);

    expect(ctx2.getVariable('user')).toBe('alice');
    expect(ctx2.getVariable('token')).toBe('secret-123');
    expect(ctx2.outputs).toEqual({ pageTitle: 'Hello World' });
    expect(ctx2.artifacts).toEqual(['/tmp/screenshot.png']);
    expect(ctx2.errors).toHaveLength(1);
    expect(ctx2.errors[0]?.stepId).toBe('step-1');
    expect(ctx2.errors[0]?.message).toBe('Navigation failed');
    expect(ctx2.errors[0]?.timestamp).toBeInstanceOf(Date);

    // stepsCompleted is a private field — test via toResult.
    const result = ctx2.toResult(5);
    expect(result.stepsCompleted).toBe(2);
  });

  it('snapshot does not mutate the original context', () => {
    const ctx = new RunContext('test-automation', logger);
    ctx.setVariable('key', 'original-value');
    ctx.addOutput('x', 42);

    const snapshot = snapshotRunContext(ctx);

    // Mutate the snapshot.
    const s = snapshot as { variables: Array<[string, string]>; outputs: Record<string, unknown> };
    s.variables.push(['injected', 'bad']);
    s.outputs['y'] = 99;

    // Original context is untouched.
    expect(ctx.getVariable('injected')).toBeUndefined();
    expect(ctx.outputs['y']).toBeUndefined();
  });

  it('restoring snapshot does not share references with snapshot object', () => {
    const ctx = new RunContext('test-automation', logger);
    ctx.setVariable('shared', 'value');
    ctx.addArtifact('/file.txt');

    const snapshot = snapshotRunContext(ctx);

    const ctx2 = new RunContext('test-automation', logger);
    restoreRunContext(ctx2, snapshot);

    // Mutating ctx2 after restore should not affect the snapshot.
    ctx2.setVariable('new-var', 'added-post-restore');
    const s = snapshot as { variables: Array<[string, string]> };
    const hasNewVar = s.variables.some(([k]) => k === 'new-var');
    expect(hasNewVar).toBe(false);
  });

  it('restores empty state cleanly', () => {
    const ctx = new RunContext('test-automation', logger);
    // No variables, outputs, artifacts, errors.

    const snapshot = snapshotRunContext(ctx);

    const ctx2 = new RunContext('test-automation', logger);
    // Pre-populate ctx2 with something.
    ctx2.setVariable('old', 'data');
    ctx2.addArtifact('/old-artifact.png');

    // Restore the empty snapshot — should wipe the pre-existing state.
    restoreRunContext(ctx2, snapshot);

    expect(ctx2.getVariable('old')).toBeUndefined();
    expect(ctx2.artifacts).toHaveLength(0);
    expect(ctx2.errors).toHaveLength(0);
  });

  it('error timestamps are re-hydrated as Date instances after restore', () => {
    const ctx = new RunContext('test-automation', logger);
    ctx.addError('step-2', 'Click', 'Element not found');

    const snapshot = snapshotRunContext(ctx);
    const ctx2 = new RunContext('test-automation', logger);
    restoreRunContext(ctx2, snapshot);

    expect(ctx2.errors[0]?.timestamp).toBeInstanceOf(Date);
  });
});
