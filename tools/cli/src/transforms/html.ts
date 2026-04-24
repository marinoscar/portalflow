import { load } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';
import TurndownService from 'turndown';

export type HtmlFormat = 'raw' | 'simplified' | 'markdown';

/**
 * File extension to use when writing the transformed output to disk.
 * Kept in sync with `transformHtml` — every format the transform accepts
 * has a corresponding extension.
 */
export function formatExtension(format: HtmlFormat): string {
  switch (format) {
    case 'raw':
      return 'html';
    case 'simplified':
      return 'yaml';
    case 'markdown':
      return 'md';
  }
}

/**
 * Transform a raw HTML string into the requested output format.
 *
 *   - 'raw'        — pass-through. The caller already has HTML; the only
 *                    value-add is writing it to disk.
 *   - 'simplified' — DOM walk that drops scripts/styles/comments and most
 *                    attributes, keeps tag + a short allow-list of
 *                    semantically-meaningful attrs (id, role, aria-*,
 *                    href, name, type, value, alt, title, data-testid),
 *                    and collapses whitespace. Serializes as YAML —
 *                    compact and LLM-friendly.
 *   - 'markdown'   — HTML → Markdown via turndown. Loses interactive
 *                    element info but very compact for readable content.
 */
export function transformHtml(raw: string, format: HtmlFormat): string {
  if (format === 'raw') return raw;
  if (format === 'markdown') return toMarkdown(raw);
  return toSimplifiedYaml(raw);
}

// ---------------------------------------------------------------------------
// simplified → YAML
// ---------------------------------------------------------------------------

// Tags whose entire subtree is stripped. Scripts and styles carry no
// rendered content; template elements are inactive; link/meta live in
// <head> and rarely add value for page-understanding use cases.
const DROP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'link',
  'meta',
  'svg',
  'path',
]);

// Attributes worth keeping. Everything else (class, style, data-* except
// data-testid, event handlers, tracking ids, etc.) is discarded. The
// goal is to preserve semantics an LLM or diff tool would use, not
// styling or analytics metadata.
const KEEP_ATTRS = new Set([
  'id',
  'role',
  'href',
  'src',
  'name',
  'type',
  'value',
  'alt',
  'title',
  'placeholder',
  'for',
  'data-testid',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-current',
  'aria-expanded',
  'aria-hidden',
  'aria-selected',
  'aria-checked',
]);

interface SimplifiedNode {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: SimplifiedNode[];
}

function toSimplifiedYaml(raw: string): string {
  const $ = load(raw);
  const root = $('html').get(0) ?? $.root().get(0);
  if (!root) return '';
  const tree = walk(root);
  if (!tree) return '';
  return serializeYaml(tree, 0);
}

function walk(node: AnyNode): SimplifiedNode | null {
  if (node.type === 'root') {
    const children = collectChildren(node.children);
    if (children.length === 1) return children[0] ?? null;
    return { tag: 'root', children: children.length ? children : undefined };
  }
  if (node.type !== 'tag') return null;
  const el = node as Element;
  if (DROP_TAGS.has(el.tagName)) return null;

  const simplified: SimplifiedNode = { tag: el.tagName };
  const attrs = collectAttrs(el);
  if (attrs) simplified.attrs = attrs;

  const children = collectChildren(el.children);
  const directText = collectDirectText(el);

  if (children.length === 0 && directText) {
    simplified.text = directText;
  } else if (children.length > 0) {
    simplified.children = children;
    if (directText) simplified.text = directText;
  }

  return simplified;
}

function collectChildren(nodes: AnyNode[]): SimplifiedNode[] {
  const out: SimplifiedNode[] = [];
  for (const child of nodes) {
    const walked = walk(child);
    if (walked) out.push(walked);
  }
  return out;
}

function collectAttrs(el: Element): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(el.attribs ?? {})) {
    if (KEEP_ATTRS.has(key) || key.startsWith('aria-')) {
      out[key] = typeof value === 'string' ? value : String(value);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Collect only the text nodes that are direct children of this element —
// nested element text belongs to the child nodes themselves, and joining
// everything would duplicate content in the serialized tree.
function collectDirectText(el: Element): string | undefined {
  const parts: string[] = [];
  for (const child of el.children) {
    if (child.type === 'text') {
      const t = (child as { data: string }).data;
      if (t && t.trim()) parts.push(t);
    }
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > 0 ? joined : undefined;
}

function serializeYaml(node: SimplifiedNode, indent: number): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  lines.push(`${pad}- tag: ${node.tag}`);
  const childPad = '  '.repeat(indent + 1);
  if (node.attrs) {
    lines.push(`${childPad}attrs:`);
    for (const [k, v] of Object.entries(node.attrs)) {
      lines.push(`${childPad}  ${yamlKey(k)}: ${yamlString(v)}`);
    }
  }
  if (node.text !== undefined) {
    lines.push(`${childPad}text: ${yamlString(node.text)}`);
  }
  if (node.children && node.children.length > 0) {
    lines.push(`${childPad}children:`);
    for (const child of node.children) {
      lines.push(serializeYaml(child, indent + 2));
    }
  }
  return lines.join('\n');
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlString(value: string): string {
  // Always quote: text/attr values can contain colons, leading dashes,
  // and other YAML-significant punctuation. JSON encoding is a safe
  // superset for YAML double-quoted scalars.
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// markdown → turndown
// ---------------------------------------------------------------------------

function toMarkdown(raw: string): string {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  service.remove(['script', 'style', 'noscript']);
  return service.turndown(raw).trim();
}
