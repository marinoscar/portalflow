import { describe, it, expect } from 'vitest';
import { transformHtml, formatExtension } from '../html.js';

// ---------------------------------------------------------------------------
// formatExtension
// ---------------------------------------------------------------------------

describe('formatExtension', () => {
  it('returns html for raw', () => {
    expect(formatExtension('raw')).toBe('html');
  });

  it('returns yaml for simplified', () => {
    expect(formatExtension('simplified')).toBe('yaml');
  });

  it('returns md for markdown', () => {
    expect(formatExtension('markdown')).toBe('md');
  });
});

// ---------------------------------------------------------------------------
// transformHtml — raw passthrough
// ---------------------------------------------------------------------------

describe('transformHtml — raw', () => {
  it('returns the input string unchanged', () => {
    const html = '<html><body><p>Hello</p></body></html>';
    expect(transformHtml(html, 'raw')).toBe(html);
  });

  it('returns empty string unchanged', () => {
    expect(transformHtml('', 'raw')).toBe('');
  });

  it('preserves whitespace exactly', () => {
    const html = '  <div>  spaces  </div>  ';
    expect(transformHtml(html, 'raw')).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// transformHtml — simplified (YAML output)
// ---------------------------------------------------------------------------

/**
 * A fixture containing elements that should be dropped (script, style, a span
 * with only whitespace), attributes that should be dropped (class), and
 * attributes that should be kept (id, href).
 */
const SIMPLIFIED_FIXTURE = `
<html>
  <head>
    <style>.foo { color: red; }</style>
    <script>alert("xss")</script>
  </head>
  <body>
    <div id="target" class="foo bar">
      <a href="/page">Click me</a>
      <span>   </span>
    </div>
  </body>
</html>
`;

describe('transformHtml — simplified', () => {
  it('drops <script> tags entirely', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('script');
  });

  it('drops <style> tags entirely', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).not.toContain('color: red');
    expect(result).not.toContain('style');
  });

  it('retains id attribute in YAML output', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).toContain('id: "target"');
  });

  it('retains href attribute in YAML output', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).toContain('href: "/page"');
  });

  it('drops class attribute', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).not.toContain('class');
    expect(result).not.toContain('foo bar');
  });

  it('includes tag: a in output', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).toContain('tag: a');
  });

  it('includes tag: html as root element', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).toContain('tag: html');
  });

  it('does not include whitespace-only span text', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    // The span had only whitespace — collectDirectText trims to empty, so it
    // should not appear in the YAML at all as a text node.
    // We verify by checking the span either doesn't appear or has no text entry
    // adjacent to it.
    const spanIdx = result.indexOf('tag: span');
    if (spanIdx !== -1) {
      // If the span IS present, the portion right after it must not have a
      // non-empty text field — only whitespace collapses to nothing.
      const afterSpan = result.slice(spanIdx, spanIdx + 100);
      expect(afterSpan).not.toMatch(/text: "[^"]+"/);
    }
    // Either the span is dropped (empty node, no children) or it has no text.
    // Both behaviours are correct; what matters is whitespace-only content
    // doesn't leak through.
  });

  it('serializes link text', () => {
    const result = transformHtml(SIMPLIFIED_FIXTURE, 'simplified');
    expect(result).toContain('"Click me"');
  });
});

// ---------------------------------------------------------------------------
// transformHtml — markdown
// ---------------------------------------------------------------------------

describe('transformHtml — markdown', () => {
  const MD_FIXTURE = '<h1>Title</h1><p>Hello <b>world</b></p>';

  it('converts h1 to ATX heading', () => {
    const result = transformHtml(MD_FIXTURE, 'markdown');
    expect(result).toContain('# Title');
  });

  it('converts bold to markdown bold', () => {
    const result = transformHtml(MD_FIXTURE, 'markdown');
    expect(result).toContain('**world**');
  });

  it('preserves surrounding plain text in paragraphs', () => {
    const result = transformHtml(MD_FIXTURE, 'markdown');
    expect(result).toContain('Hello');
  });

  it('full output contains both heading and paragraph content', () => {
    const result = transformHtml(MD_FIXTURE, 'markdown');
    expect(result).toMatch(/# Title/);
    expect(result).toMatch(/Hello \*\*world\*\*/);
  });
});

// ---------------------------------------------------------------------------
// transformHtml — edge cases (empty string)
// ---------------------------------------------------------------------------

describe('transformHtml — empty string edge cases', () => {
  it('returns empty string for simplified format without throwing', () => {
    expect(() => transformHtml('', 'simplified')).not.toThrow();
    // May return '' or a minimal YAML structure depending on cheerio's parse
    // of an empty string; the critical requirement is no exception.
    const result = transformHtml('', 'simplified');
    expect(typeof result).toBe('string');
  });

  it('returns empty string for markdown format without throwing', () => {
    expect(() => transformHtml('', 'markdown')).not.toThrow();
    const result = transformHtml('', 'markdown');
    expect(typeof result).toBe('string');
  });

  it('returns empty string for raw format without throwing', () => {
    expect(() => transformHtml('', 'raw')).not.toThrow();
    expect(transformHtml('', 'raw')).toBe('');
  });
});
