import { describe, it, expect } from 'vitest';
import { ExitCodes, exitCodeForError } from '../exit-codes.js';

// ---------------------------------------------------------------------------
// ExitCodes constants
// ---------------------------------------------------------------------------

describe('ExitCodes', () => {
  it('Ok is 0', () => {
    expect(ExitCodes.Ok).toBe(0);
  });

  it('Runtime is 1', () => {
    expect(ExitCodes.Runtime).toBe(1);
  });

  it('Schema is 2', () => {
    expect(ExitCodes.Schema).toBe(2);
  });

  it('Auth is 3', () => {
    expect(ExitCodes.Auth).toBe(3);
  });

  it('Extension is 4', () => {
    expect(ExitCodes.Extension).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// exitCodeForError — Auth patterns
// ---------------------------------------------------------------------------

describe('exitCodeForError — Auth (3)', () => {
  it('maps "LLM connectivity check failed: ..." to Auth', () => {
    const err = new Error('LLM connectivity check failed: 401 Unauthorized');
    expect(exitCodeForError(err)).toBe(ExitCodes.Auth);
  });

  it('maps "LLM pre-flight failed: ..." to Auth', () => {
    const err = new Error('LLM pre-flight failed: provider not configured');
    expect(exitCodeForError(err)).toBe(ExitCodes.Auth);
  });
});

// ---------------------------------------------------------------------------
// exitCodeForError — Extension patterns
// ---------------------------------------------------------------------------

describe('exitCodeForError — Extension (4)', () => {
  it('maps "Chrome / extension handshake failed: ..." to Extension', () => {
    const err = new Error('Chrome / extension handshake failed: foo');
    expect(exitCodeForError(err)).toBe(ExitCodes.Extension);
  });

  it('maps "Failed to open automation run window" to Extension', () => {
    const err = new Error('Failed to open automation run window');
    expect(exitCodeForError(err)).toBe(ExitCodes.Extension);
  });
});

// ---------------------------------------------------------------------------
// exitCodeForError — Runtime fallback
// ---------------------------------------------------------------------------

describe('exitCodeForError — Runtime (1) fallback', () => {
  it('maps an unrecognised Error message to Runtime', () => {
    const err = new Error('something else went wrong');
    expect(exitCodeForError(err)).toBe(ExitCodes.Runtime);
  });

  it('maps a plain string (non-Error) to Runtime', () => {
    expect(exitCodeForError('some string error')).toBe(ExitCodes.Runtime);
  });

  it('maps undefined to Runtime', () => {
    expect(exitCodeForError(undefined)).toBe(ExitCodes.Runtime);
  });

  it('maps null to Runtime', () => {
    expect(exitCodeForError(null)).toBe(ExitCodes.Runtime);
  });

  it('maps an object (non-Error) to Runtime', () => {
    expect(exitCodeForError({ code: 42 })).toBe(ExitCodes.Runtime);
  });
});
