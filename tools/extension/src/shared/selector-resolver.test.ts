/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSelector, resolveSelectorOrThrow } from './selector-resolver';
import type { SelectorCascade } from './runner-protocol';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('resolveSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the element when the primary selector matches', () => {
    setBody('<button id="submit-btn">Submit</button>');
    const cascade: SelectorCascade = { primary: '#submit-btn' };
    const el = resolveSelector(document, cascade);
    expect(el).not.toBeNull();
    expect(el?.id).toBe('submit-btn');
  });

  it('falls through to the first matching fallback when primary fails', () => {
    setBody('<input name="email" />');
    const cascade: SelectorCascade = {
      primary: '#nonexistent',
      fallbacks: ['[data-testid="missing"]', 'input[name="email"]'],
    };
    const el = resolveSelector(document, cascade);
    expect(el).not.toBeNull();
    expect((el as HTMLInputElement).name).toBe('email');
  });

  it('returns null when all selectors fail to match', () => {
    setBody('<p>no matching element</p>');
    const cascade: SelectorCascade = {
      primary: '#gone',
      fallbacks: ['.also-gone', 'span.nope'],
    };
    const el = resolveSelector(document, cascade);
    expect(el).toBeNull();
  });

  it('falls through an invalid CSS primary to a valid fallback', () => {
    setBody('<div class="target">hello</div>');
    const cascade: SelectorCascade = {
      // deliberately malformed selector
      primary: '::invalid-pseudo-that-throws',
      fallbacks: ['.target'],
    };
    // Should not throw; should find .target via the fallback
    const el = resolveSelector(document, cascade);
    expect(el).not.toBeNull();
    expect((el as HTMLElement).textContent).toBe('hello');
  });

  it('finds an element inside an open shadow root', () => {
    // Build a host with an open shadow root containing a button
    const host = document.createElement('div');
    host.id = 'shadow-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.id = 'shadow-btn';
    shadow.appendChild(btn);

    const cascade: SelectorCascade = { primary: '#shadow-btn' };
    const el = resolveSelector(document, cascade);
    expect(el).not.toBeNull();
    expect(el?.id).toBe('shadow-btn');
  });
});

describe('resolveSelectorOrThrow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the element when found', () => {
    setBody('<a href="#" id="link">Go</a>');
    const cascade: SelectorCascade = { primary: '#link' };
    const el = resolveSelectorOrThrow(document, cascade, 'cmd-001');
    expect(el.id).toBe('link');
  });

  it('throws a descriptive error including commandId when nothing matches', () => {
    setBody('<p>nothing</p>');
    const cascade: SelectorCascade = {
      primary: '#missing',
      fallbacks: ['.also-missing'],
    };
    expect(() => resolveSelectorOrThrow(document, cascade, 'cmd-abc')).toThrow(
      /cmd-abc/,
    );
    expect(() => resolveSelectorOrThrow(document, cascade, 'cmd-abc')).toThrow(
      /selector_not_found/,
    );
  });
});
