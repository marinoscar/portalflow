/**
 * Content script for PortalFlow runtime DOM actions.
 *
 * Listens on the 'runner-dom' channel (distinct from the service worker's
 * 'runner' channel). The service-worker handlers send messages here and await
 * the reply; this script performs the actual DOM interaction.
 *
 * IMPORTANT: Do not read or write any state belonging to recorder.ts.
 * Use distinct listener, channel, and storage keys.
 */

import { resolveSelector } from '../shared/selector-resolver';
import type { SelectorCascade } from '../shared/runner-protocol';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface ClickOp {
  channel: 'runner-dom';
  op: 'click';
  commandId: string;
  cascade: SelectorCascade;
}

interface TypeOp {
  channel: 'runner-dom';
  op: 'type';
  commandId: string;
  cascade: SelectorCascade;
  text: string;
}

interface ExtractOp {
  channel: 'runner-dom';
  op: 'extract';
  commandId: string;
  target: 'text' | 'attribute' | 'html' | 'url' | 'title';
  cascade?: SelectorCascade;
  attribute?: string;
}

type RunnerDomMessage = ClickOp | TypeOp | ExtractOp;

interface DomReply {
  ok: boolean;
  value?: unknown;
  message?: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the element is visible and interactable.
 * An element with offsetParent === null is either display:none or
 * inside a hidden ancestor; disabled is a self-explanatory check.
 */
function isActionable(el: Element): boolean {
  if ((el as HTMLElement).offsetParent === null) return false;
  if ((el as HTMLButtonElement | HTMLInputElement).disabled) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

function handleClick(msg: ClickOp): DomReply {
  const el = resolveSelector(document, msg.cascade);
  if (!el) {
    return { ok: false, message: 'selector_not_found', code: 'selector_not_found' };
  }
  if (!isActionable(el)) {
    return { ok: false, message: 'element_not_actionable', code: 'element_not_actionable' };
  }
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  (el as HTMLElement).click();
  return { ok: true };
}

function handleType(msg: TypeOp): DomReply {
  const el = resolveSelector(document, msg.cascade);
  if (!el) {
    return { ok: false, message: 'selector_not_found', code: 'selector_not_found' };
  }

  const isInput = el instanceof HTMLInputElement;
  const isTextarea = el instanceof HTMLTextAreaElement;
  const isContentEditable =
    !isInput &&
    !isTextarea &&
    (el as HTMLElement).isContentEditable;

  if (!isInput && !isTextarea && !isContentEditable) {
    return {
      ok: false,
      message: 'element_not_typeable: expected input, textarea, or contenteditable',
      code: 'element_not_typeable',
    };
  }

  (el as HTMLElement).focus();

  if (isInput || isTextarea) {
    const target = el as HTMLInputElement | HTMLTextAreaElement;
    // Clear existing value
    target.value = '';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    // Set new value
    target.value = msg.text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // contenteditable
    (el as HTMLElement).textContent = msg.text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return { ok: true };
}

function handleExtract(msg: ExtractOp): DomReply {
  switch (msg.target) {
    case 'url':
      return { ok: true, value: window.location.href };

    case 'title':
      return { ok: true, value: document.title };

    case 'text': {
      if (!msg.cascade) {
        return { ok: false, message: 'extract text requires a cascade selector', code: 'missing_selector' };
      }
      const el = resolveSelector(document, msg.cascade);
      if (!el) {
        return { ok: false, message: 'selector_not_found', code: 'selector_not_found' };
      }
      return { ok: true, value: el.textContent ?? '' };
    }

    case 'attribute': {
      if (!msg.cascade) {
        return { ok: false, message: 'extract attribute requires a cascade selector', code: 'missing_selector' };
      }
      if (!msg.attribute) {
        return { ok: false, message: 'extract attribute requires an attribute name', code: 'missing_attribute' };
      }
      const el = resolveSelector(document, msg.cascade);
      if (!el) {
        return { ok: false, message: 'selector_not_found', code: 'selector_not_found' };
      }
      return { ok: true, value: el.getAttribute(msg.attribute) };
    }

    case 'html': {
      if (msg.cascade) {
        const el = resolveSelector(document, msg.cascade);
        if (!el) {
          return { ok: false, message: 'selector_not_found', code: 'selector_not_found' };
        }
        return { ok: true, value: el.outerHTML };
      }
      return { ok: true, value: document.documentElement.outerHTML };
    }

    default:
      return { ok: false, message: 'unknown extract target', code: 'unknown_target' };
  }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    msg: unknown,
    _sender,
    sendResponse: (response: DomReply) => void,
  ) => {
    const m = msg as Partial<RunnerDomMessage>;
    if (m.channel !== 'runner-dom') {
      return false; // not our message
    }

    try {
      let reply: DomReply;
      switch (m.op) {
        case 'click':
          reply = handleClick(msg as ClickOp);
          break;
        case 'type':
          reply = handleType(msg as TypeOp);
          break;
        case 'extract':
          reply = handleExtract(msg as ExtractOp);
          break;
        default:
          reply = { ok: false, message: 'unknown op', code: 'unknown_op' };
      }
      sendResponse(reply);
    } catch (err) {
      sendResponse({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        code: 'internal_error',
      });
    }

    return false; // reply is synchronous
  },
);
