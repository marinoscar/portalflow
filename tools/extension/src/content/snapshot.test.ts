/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { captureSnapshot } from './snapshot';

// jsdom does not implement SubtleCrypto by default. Provide a minimal SHA-256
// shim that produces the same digest values a real browser would.
beforeEach(async () => {
  if (!globalThis.crypto?.subtle?.digest) {
    const { webcrypto } = await import('node:crypto');
    // @ts-expect-error — overwrite for test env
    globalThis.crypto = webcrypto;
  }
});

function setDocument(html: string) {
  document.documentElement.innerHTML = html;
}

describe('captureSnapshot', () => {
  it('returns content, id, url, and title', async () => {
    setDocument('<head><title>Hello</title></head><body><p>Hi</p></body>');
    const snap = await captureSnapshot();
    expect(snap.id).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.content).toContain('<p>Hi</p>');
    expect(snap.title).toBe('Hello');
    expect(snap.url).toMatch(/^about:blank|https?:/);
    expect(snap.sizeBytes).toBe(snap.content.length);
  });

  it('strips script, style, and noscript elements', async () => {
    setDocument(`
      <head>
        <title>T</title>
        <style>.a { color: red; }</style>
      </head>
      <body>
        <script>alert('nope');</script>
        <noscript>fallback</noscript>
        <p>real content</p>
      </body>
    `);
    const snap = await captureSnapshot();
    expect(snap.content).not.toContain('<script');
    expect(snap.content).not.toContain('<style');
    expect(snap.content).not.toContain('<noscript');
    expect(snap.content).not.toContain("alert('nope')");
    expect(snap.content).toContain('<p>real content</p>');
  });

  it('removes HTML comments', async () => {
    setDocument('<body><!-- secret --><p>kept</p></body>');
    const snap = await captureSnapshot();
    expect(snap.content).not.toContain('secret');
    expect(snap.content).toContain('<p>kept</p>');
  });

  it('collapses whitespace inside text nodes', async () => {
    setDocument('<body><p>hello   world\n\n  again</p></body>');
    const snap = await captureSnapshot();
    expect(snap.content).toContain('hello world again');
  });

  it('produces a stable hash for identical input', async () => {
    setDocument('<body><p>stable</p></body>');
    const a = await captureSnapshot();
    const b = await captureSnapshot();
    expect(a.id).toBe(b.id);
    expect(a.content).toBe(b.content);
  });

  it('produces a different hash when the content changes', async () => {
    setDocument('<body><p>first</p></body>');
    const a = await captureSnapshot();
    setDocument('<body><p>second</p></body>');
    const b = await captureSnapshot();
    expect(a.id).not.toBe(b.id);
  });

  it('honors the maxBytes cap and marks the output as truncated', async () => {
    const big = '<p>' + 'x'.repeat(500_000) + '</p>';
    setDocument(`<body>${big}</body>`);
    const snap = await captureSnapshot(1000);
    expect(snap.content.length).toBeLessThanOrEqual(1000 + '<!-- [truncated] -->'.length);
    expect(snap.content.endsWith('<!-- [truncated] -->')).toBe(true);
  });

  it('drops elements hidden via display:none inline style', async () => {
    setDocument(
      '<body><p>visible</p><p style="display:none">hidden</p></body>',
    );
    const snap = await captureSnapshot();
    expect(snap.content).toContain('visible');
    expect(snap.content).not.toContain('hidden');
  });

  it('drops elements with aria-hidden="true"', async () => {
    setDocument('<body><p>v</p><p aria-hidden="true">ignored</p></body>');
    const snap = await captureSnapshot();
    expect(snap.content).toContain('<p>v</p>');
    expect(snap.content).not.toContain('ignored');
  });
});
