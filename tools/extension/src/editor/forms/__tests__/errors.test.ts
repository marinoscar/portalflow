import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { fieldErrorsForPath } from '../errors';
import type { ValidationResult } from '../../state/editor-state';

// ---------------------------------------------------------------------------
// Helpers to build fake SafeParseReturnType values without running Zod
// ---------------------------------------------------------------------------

function fakeSuccess(): ValidationResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { success: true, data: {} as any };
}

function fakeFailure(
  issues: Array<{ path: (string | number)[]; message: string }>,
): ValidationResult {
  const zodIssues: z.ZodIssue[] = issues.map((i) => ({
    code: z.ZodIssueCode.custom,
    path: i.path,
    message: i.message,
  }));
  return {
    success: false,
    error: new z.ZodError(zodIssues),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fieldErrorsForPath', () => {
  it('returns {} when validation.success is true', () => {
    const result = fieldErrorsForPath(fakeSuccess(), ['steps', 3, 'action']);
    expect(result).toEqual({});
  });

  it('returns {} when there are no issues matching the prefix', () => {
    const validation = fakeFailure([{ path: ['inputs', 0, 'name'], message: 'Required' }]);
    const result = fieldErrorsForPath(validation, ['steps', 0, 'action']);
    expect(result).toEqual({});
  });

  it('picks up an error whose path starts with the prefix', () => {
    const validation = fakeFailure([
      { path: ['steps', 3, 'action', 'url'], message: 'Required' },
    ]);
    const result = fieldErrorsForPath(validation, ['steps', 3, 'action']);
    expect(result).toEqual({ url: 'Required' });
  });

  it('does NOT include errors at paths that do not start with the prefix', () => {
    const validation = fakeFailure([
      { path: ['steps', 3, 'action', 'url'], message: 'Required' },
      { path: ['steps', 4, 'action', 'url'], message: 'Wrong step' },
      { path: ['inputs', 0, 'name'], message: 'Elsewhere' },
    ]);
    const result = fieldErrorsForPath(validation, ['steps', 3, 'action']);
    expect(result).toEqual({ url: 'Required' });
    expect(Object.keys(result)).toHaveLength(1);
  });

  it('keys the result by the path segment immediately after the prefix', () => {
    const validation = fakeFailure([
      { path: ['steps', 0, 'action', 'interaction'], message: 'Bad interaction' },
      { path: ['steps', 0, 'action', 'value'], message: 'Too long' },
    ]);
    const result = fieldErrorsForPath(validation, ['steps', 0, 'action']);
    expect(result['interaction']).toBe('Bad interaction');
    expect(result['value']).toBe('Too long');
  });

  it('ignores issues where the path is exactly the prefix (not deeper)', () => {
    const validation = fakeFailure([
      { path: ['steps', 0, 'action'], message: 'Whole action invalid' },
    ]);
    const result = fieldErrorsForPath(validation, ['steps', 0, 'action']);
    expect(result).toEqual({});
  });

  it('ignores issues where the path is shorter than the prefix', () => {
    const validation = fakeFailure([
      { path: ['steps'], message: 'Steps invalid' },
    ]);
    const result = fieldErrorsForPath(validation, ['steps', 0, 'action']);
    expect(result).toEqual({});
  });

  it('uses first-seen error for a given key (subsequent errors at same key are ignored)', () => {
    // Two errors under 'url' at the same prefix — first one wins
    const validation = fakeFailure([
      { path: ['steps', 0, 'action', 'url'], message: 'First error' },
      { path: ['steps', 0, 'action', 'url'], message: 'Second error' },
    ]);
    const result = fieldErrorsForPath(validation, ['steps', 0, 'action']);
    expect(result['url']).toBe('First error');
  });

  it('collapses deeply nested paths past prefix+1 under the first-after-prefix key', () => {
    // Both of these are under 'successCheck' — they collapse to that key
    const validation = fakeFailure([
      { path: ['steps', 0, 'action', 'successCheck', 'value'], message: 'Required' },
      { path: ['steps', 0, 'action', 'successCheck', 'check'], message: 'Required' },
    ]);
    const result = fieldErrorsForPath(validation, ['steps', 0, 'action']);
    expect('successCheck' in result).toBe(true);
  });

  it('works with a numeric segment in the prefix', () => {
    const validation = fakeFailure([
      { path: ['functions', 2, 'steps', 0, 'action', 'goal'], message: 'Required' },
    ]);
    const result = fieldErrorsForPath(validation, ['functions', 2, 'steps', 0, 'action']);
    expect(result).toEqual({ goal: 'Required' });
  });

  it('returns {} for an empty prefix with errors present', () => {
    // Prefix of [] means "any path of length >= 1" — first segment is the key
    const validation = fakeFailure([
      { path: ['name'], message: 'Too short' },
    ]);
    const result = fieldErrorsForPath(validation, []);
    expect(result['name']).toBe('Too short');
  });
});
