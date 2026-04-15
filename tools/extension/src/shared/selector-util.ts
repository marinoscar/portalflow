/**
 * Pure, dependency-free selector utilities shared between:
 *   - tools/extension/src/content/selector-builder.ts  (recorder side)
 *   - tools/extension/src/shared/selector-resolver.ts   (runner side)
 *
 * No DOM globals are called at import time; every function receives its
 * document/root as a parameter or accesses `document` lazily so the module
 * can be imported in non-browser test environments.
 */

// ---------------------------------------------------------------------------
// CSS helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a CSS identifier value using CSS.escape when available,
 * falling back to a minimal double-quote escape for attribute values.
 */
export function cssEscape(value: string): string {
  const w = globalThis as typeof globalThis & {
    CSS?: { escape?: (v: string) => string };
  };
  if (typeof w.CSS?.escape === 'function') {
    return w.CSS.escape!(value);
  }
  return value.replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Selector validity
// ---------------------------------------------------------------------------

/**
 * Returns true when `sel` is a syntactically valid CSS selector.
 * Uses `document.querySelector` as the parse gate — no results matter.
 */
export function isValidCssSelector(sel: string): boolean {
  try {
    document.querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shadow-DOM-piercing queries
// ---------------------------------------------------------------------------

/**
 * Walk every open shadow root reachable from `root`, returning the first
 * element matched by `selector`, or null if nothing matches.
 *
 * Traversal is breadth-first; the light-DOM is tried first so predictable
 * shadow hosts (e.g. custom elements wrapping a plain input) resolve quickly.
 */
export function querySelectorPiercingShadowRoots(
  root: Document | ShadowRoot,
  selector: string,
): Element | null {
  // Fast path: check the light DOM first
  const direct = root.querySelector(selector);
  if (direct) return direct;

  // BFS through open shadow roots
  const queue: (Document | ShadowRoot)[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    // Enumerate every element in current root and push shadow roots onto queue
    const all = current.querySelectorAll('*');
    for (const el of Array.from(all)) {
      const sr = (el as HTMLElement).shadowRoot;
      if (!sr) continue;
      const found = sr.querySelector(selector);
      if (found) return found;
      queue.push(sr);
    }
  }
  return null;
}

/**
 * Like `querySelectorAll().length` but pierces open shadow roots.
 */
export function matchCount(root: Document | ShadowRoot, selector: string): number {
  let count = root.querySelectorAll(selector).length;

  const queue: (Document | ShadowRoot)[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const all = current.querySelectorAll('*');
    for (const el of Array.from(all)) {
      const sr = (el as HTMLElement).shadowRoot;
      if (!sr) continue;
      count += sr.querySelectorAll(selector).length;
      queue.push(sr);
    }
  }
  return count;
}
