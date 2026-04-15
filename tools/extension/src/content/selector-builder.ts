import { cssEscape, isValidCssSelector } from '../shared/selector-util';

/**
 * Build a stable selector for an element, plus a small set of fallbacks.
 * Strategies are tried in order of stability; the first match becomes `primary`
 * and the next 2-3 successful matches become `fallbacks`.
 */
export function buildSelector(element: Element): { primary: string; fallbacks: string[] } {
  const strategies: Array<() => string | null> = [
    () => tryDataTestAttribute(element),
    () => tryId(element),
    () => tryName(element),
    () => tryAriaLabel(element),
    () => tryRoleAndText(element),
    () => tryShortCssPath(element),
    () => tryTagAndClass(element),
  ];

  const results: string[] = [];
  for (const strat of strategies) {
    const sel = strat();
    if (sel && isValidSelector(sel)) {
      results.push(sel);
    }
    if (results.length >= 4) break;
  }

  if (results.length === 0) {
    return { primary: computeAbsoluteCssPath(element), fallbacks: [] };
  }

  return {
    primary: results[0]!,
    fallbacks: results.slice(1),
  };
}

// --- strategies ---

function tryDataTestAttribute(el: Element): string | null {
  for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
    const value = el.getAttribute(attr);
    if (value) return `[${attr}="${cssEscape(value)}"]`;
  }
  return null;
}

function tryId(el: Element): string | null {
  const id = el.id;
  if (!id) return null;
  // Avoid dynamic-looking ids (e.g., MUI's "mui-1234")
  if (/^(mui|radix|aria)-\d+$/i.test(id) || /\d{4,}/.test(id)) return null;
  return `#${cssEscape(id)}`;
}

function tryName(el: Element): string | null {
  if (
    !(
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLButtonElement
    )
  ) {
    return null;
  }
  const name = el.getAttribute('name');
  if (!name) return null;
  return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
}

function tryAriaLabel(el: Element): string | null {
  const label = el.getAttribute('aria-label');
  if (label) return `${el.tagName.toLowerCase()}[aria-label="${cssEscape(label)}"]`;
  return null;
}

function tryRoleAndText(el: Element): string | null {
  const role = el.getAttribute('role');
  const text = (el.textContent ?? '').trim();
  if (role && text && text.length < 40) {
    return `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"]`;
  }
  return null;
}

function tryShortCssPath(el: Element): string | null {
  // Walk up at most 3 levels, picking the most distinctive selector at each level
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.tagName !== 'BODY' && depth < 3) {
    const tag = node.tagName.toLowerCase();
    const classes = Array.from(node.classList)
      .filter((c) => !/^(is-|has-|ng-|_[a-z])/.test(c) && !/\d{3,}/.test(c))
      .slice(0, 2);
    const part = classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
    parts.unshift(part);
    node = node.parentElement;
    depth++;
  }
  if (parts.length === 0) return null;
  return parts.join(' > ');
}

function tryTagAndClass(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => !/^(is-|has-|ng-|_[a-z])/.test(c) && !/\d{3,}/.test(c))
    .slice(0, 2);
  if (classes.length === 0) return tag;
  return `${tag}.${classes.join('.')}`;
}

function computeAbsoluteCssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.parentElement) {
    const parent: Element = node.parentElement;
    const currentTag = node.tagName;
    const siblings = Array.from(parent.children).filter((c: Element) => c.tagName === currentTag);
    const index = siblings.indexOf(node);
    const part =
      siblings.length === 1
        ? node.tagName.toLowerCase()
        : `${node.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
    parts.unshift(part);
    node = parent;
    if (node.tagName === 'BODY' || node.tagName === 'HTML') break;
  }
  return parts.join(' > ');
}

function isValidSelector(sel: string): boolean {
  return isValidCssSelector(sel);
}
