/**
 * Simplified HTML snapshot capture for the content script.
 *
 * The recorder calls `captureSnapshot()` at the moment each user event is
 * emitted so the service worker can attach page context to the event. The
 * snapshot is aggressively pared down so it fits in chrome.storage.local
 * even for long sessions and remains cheap to ship to an LLM later:
 *
 * - Scripts, styles, and noscript blocks are removed.
 * - Elements hidden by computed style (display:none, visibility:hidden,
 *   opacity:0 with pointer-events off) and aria-hidden="true" are dropped.
 * - HTML comments are stripped.
 * - Runs of whitespace in text nodes collapse to a single space.
 * - Content is truncated to `maxBytes` characters.
 * - The final simplified string is hashed with SHA-256 for dedupe.
 *
 * Mirrors the spirit of `simplifyHtml` in tools/cli/src/browser/context.ts
 * but operates on the live DOM rather than an HTML string, since the
 * content script has direct DOM access.
 */

export interface SnapshotResult {
  /** SHA-256 hex digest of `content`. Doubles as a dedupe key. */
  id: string;
  /** Simplified HTML string, ready to store or send to an LLM. */
  content: string;
  /** Length of `content` in characters. */
  sizeBytes: number;
  url: string;
  title: string;
}

const DEFAULT_MAX_BYTES = 200_000;

const STRIPPABLE_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
]);

function isVisuallyHidden(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.getAttribute('hidden') !== null) return true;
  // Only Element instances that also have getBoundingClientRect (HTMLElement
  // / SVGElement) can be measured. Skip anything else.
  if (!(el instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(el);
  if (style.display === 'none') return true;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
  // Fully transparent AND non-interactive elements are effectively hidden.
  if (
    parseFloat(style.opacity || '1') === 0 &&
    style.pointerEvents === 'none'
  ) {
    return true;
  }
  return false;
}

/**
 * Returns a clone of `root` with scripts/styles/comments/hidden elements
 * removed. Uses the *live* DOM for visibility checks (cloned nodes do not
 * have computed styles), then filters the clone in a second pass.
 */
function buildSimplifiedClone(root: Element): Element {
  // First pass: collect the set of live elements we want to KEEP. A walk
  // of the clone would not have reliable getComputedStyle because clones
  // aren't attached to the document, so we map live -> hidden decisions
  // first, then drop matching nodes from the clone.
  const hiddenLive = new WeakSet<Element>();
  const liveWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let liveNode: Node | null = liveWalker.currentNode;
  while (liveNode) {
    if (liveNode instanceof Element) {
      if (
        STRIPPABLE_TAGS.has(liveNode.tagName) ||
        isVisuallyHidden(liveNode)
      ) {
        hiddenLive.add(liveNode);
      }
    }
    liveNode = liveWalker.nextNode();
  }

  const clone = root.cloneNode(true) as Element;

  // Second pass: walk the clone in parallel with the live tree (same
  // structure since the clone is a deep copy) and remove cloned nodes
  // whose corresponding live node was marked hidden.
  const liveElements: Element[] = [];
  const liveStack: Element[] = [root];
  while (liveStack.length > 0) {
    const el = liveStack.pop()!;
    liveElements.push(el);
    for (let i = el.children.length - 1; i >= 0; i--) {
      liveStack.push(el.children[i]);
    }
  }

  const cloneElements: Element[] = [];
  const cloneStack: Element[] = [clone];
  while (cloneStack.length > 0) {
    const el = cloneStack.pop()!;
    cloneElements.push(el);
    for (let i = el.children.length - 1; i >= 0; i--) {
      cloneStack.push(el.children[i]);
    }
  }

  // Parallel walks produce equal-length arrays because cloneNode(true) is a
  // structural copy. Remove cloned elements whose live counterpart was
  // marked hidden.
  const toRemove: Element[] = [];
  for (let i = 0; i < liveElements.length && i < cloneElements.length; i++) {
    if (hiddenLive.has(liveElements[i])) {
      toRemove.push(cloneElements[i]);
    }
  }
  for (const el of toRemove) {
    el.parentNode?.removeChild(el);
  }

  // Third pass: strip comment nodes on the clone.
  const commentWalker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  let cNode: Node | null = commentWalker.currentNode;
  while (cNode) {
    if (cNode.nodeType === Node.COMMENT_NODE) comments.push(cNode);
    cNode = commentWalker.nextNode();
  }
  for (const c of comments) c.parentNode?.removeChild(c);

  // Fourth pass: collapse whitespace in text nodes.
  const textWalker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let tNode: Node | null = textWalker.currentNode;
  while (tNode) {
    if (tNode.nodeType === Node.TEXT_NODE && tNode.nodeValue) {
      tNode.nodeValue = tNode.nodeValue.replace(/\s+/g, ' ');
    }
    tNode = textWalker.nextNode();
  }

  return clone;
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Serializes the current document into a simplified HTML snapshot and
 * returns it along with its SHA-256 hash. Safe to call on any page; will
 * not throw even on detached documents (returns an empty content string).
 */
export async function captureSnapshot(
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<SnapshotResult> {
  const url = location.href;
  const title = document.title;

  const root = document.documentElement;
  if (!root) {
    const content = '';
    const id = await sha256Hex(content);
    return { id, content, sizeBytes: 0, url, title };
  }

  const clone = buildSimplifiedClone(root);
  let content = clone.outerHTML;

  if (content.length > maxBytes) {
    content = content.slice(0, maxBytes) + '<!-- [truncated] -->';
  }

  const id = await sha256Hex(content);
  return {
    id,
    content,
    sizeBytes: content.length,
    url,
    title,
  };
}
