/**
 * Resolves a SelectorCascade (primary + ordered fallbacks) to a DOM element.
 * Used by the runner content script to find elements during automation.
 */

import type { SelectorCascade } from './runner-protocol';
import { querySelectorPiercingShadowRoots } from './selector-util';

/**
 * Tries each selector in `cascade` in order (primary first, then fallbacks).
 * Returns the first element found, or null if none match.
 * Selector syntax errors are caught and treated as non-matches so that a
 * bad primary falls through to a valid fallback.
 */
export function resolveSelector(
  root: Document | ShadowRoot,
  cascade: SelectorCascade,
): Element | null {
  const candidates = [cascade.primary, ...(cascade.fallbacks ?? [])];
  for (const selector of candidates) {
    try {
      const el = querySelectorPiercingShadowRoots(root, selector);
      if (el) return el;
    } catch {
      // Malformed selector — skip and try next fallback
    }
  }
  return null;
}

/**
 * Same as resolveSelector but throws a descriptive error when no element
 * is found. Includes the commandId for easier debugging in extension logs.
 */
export function resolveSelectorOrThrow(
  root: Document | ShadowRoot,
  cascade: SelectorCascade,
  commandId: string,
): Element {
  const el = resolveSelector(root, cascade);
  if (!el) {
    const tried = [cascade.primary, ...(cascade.fallbacks ?? [])].join(', ');
    throw new Error(
      `[runner/${commandId}] selector_not_found: tried ${tried}`,
    );
  }
  return el;
}
