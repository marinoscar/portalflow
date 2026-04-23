import type { ValidationResult } from '../state/editor-state';

/**
 * Given a validation result and a path prefix (e.g. ['steps', 3, 'action']),
 * returns a Record<string, string> where:
 * - keys are the path segment immediately after the prefix
 * - values are the first Zod error message at that path
 *
 * Only collects issues whose path starts exactly with the prefix.
 *
 * Example:
 *   fieldErrorsForPath(validation, ['steps', 3, 'action'])
 *   → { url: 'Required' } for an issue at ['steps', 3, 'action', 'url']
 */
export function fieldErrorsForPath(
  validation: ValidationResult,
  pathPrefix: (string | number)[],
): Record<string, string> {
  if (validation.success) return {};

  const errors: Record<string, string> = {};

  for (const issue of validation.error.issues) {
    const path = issue.path;
    if (path.length <= pathPrefix.length) continue;

    // Check that path starts with the prefix
    let matches = true;
    for (let i = 0; i < pathPrefix.length; i++) {
      if (path[i] !== pathPrefix[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    // The key is the segment immediately after the prefix
    const key = String(path[pathPrefix.length]);
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}
