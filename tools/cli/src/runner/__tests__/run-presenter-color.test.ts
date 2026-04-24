import { describe, it, expect, vi, afterEach } from 'vitest';
import { RunPresenter, defaultColorEnabled } from '../run-presenter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[/;

/**
 * Spy on process.stdout.write, call fn(), and return all captured writes as
 * an array of strings.
 */
function captureStdoutWrites(fn: () => void): string[] {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return writes;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// defaultColorEnabled
// ---------------------------------------------------------------------------

describe('defaultColorEnabled', () => {
  it('returns false when NO_COLOR is set to a non-empty value', () => {
    const original = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      expect(defaultColorEnabled()).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = original;
      }
    }
  });

  it('returns true when NO_COLOR is unset and stdout is a TTY', () => {
    const original = process.env.NO_COLOR;
    delete process.env.NO_COLOR;

    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    try {
      expect(defaultColorEnabled()).toBe(true);
    } finally {
      // Restore to the original isTTY value (undefined in test env)
      Object.defineProperty(process.stdout, 'isTTY', {
        value: undefined,
        configurable: true,
      });
      if (original === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = original;
      }
    }
  });

  it('returns false when NO_COLOR is unset and stdout is not a TTY', () => {
    const original = process.env.NO_COLOR;
    delete process.env.NO_COLOR;

    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    try {
      expect(defaultColorEnabled()).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: undefined,
        configurable: true,
      });
      if (original === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = original;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// RunPresenter — colorEnabled: false
// ---------------------------------------------------------------------------

describe('RunPresenter with colorEnabled: false', () => {
  it('runStart writes no ANSI escape sequences', () => {
    const presenter = new RunPresenter(true, '/tmp/test.log', false);
    const writes = captureStdoutWrites(() => presenter.runStart('test-run', 1));
    // Every captured write must be free of ANSI codes.
    for (const w of writes) {
      expect(ANSI_RE.test(w)).toBe(false);
    }
  });

  it('runStart still writes something to stdout (presenter is enabled)', () => {
    const presenter = new RunPresenter(true, '/tmp/test.log', false);
    const writes = captureStdoutWrites(() => presenter.runStart('test-run', 1));
    expect(writes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// RunPresenter — colorEnabled: true
// ---------------------------------------------------------------------------

describe('RunPresenter with colorEnabled: true', () => {
  it('runStart produces at least one write containing an ANSI escape sequence', () => {
    const presenter = new RunPresenter(true, '/tmp/test.log', true);
    const writes = captureStdoutWrites(() => presenter.runStart('test-run', 1));
    const hasAnsi = writes.some((w) => ANSI_RE.test(w));
    expect(hasAnsi).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RunPresenter disabled (enabled: false)
// ---------------------------------------------------------------------------

describe('RunPresenter with enabled: false', () => {
  it('runStart writes nothing to stdout', () => {
    const presenter = new RunPresenter(false, '/tmp/test.log', true);
    const writes = captureStdoutWrites(() => presenter.runStart('test-run', 1));
    expect(writes).toHaveLength(0);
  });
});
