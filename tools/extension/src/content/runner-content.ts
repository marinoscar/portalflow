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
import { matchCount } from '../shared/selector-util';
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

interface WaitForSelectorOp {
  channel: 'runner-dom';
  op: 'waitForSelector';
  cascade: SelectorCascade;
  timeoutMs: number;
}

interface SelectOp {
  channel: 'runner-dom';
  op: 'select';
  commandId: string;
  cascade: SelectorCascade;
  value: string;
}

interface CheckOp {
  channel: 'runner-dom';
  op: 'check';
  commandId: string;
  cascade: SelectorCascade;
}

interface UncheckOp {
  channel: 'runner-dom';
  op: 'uncheck';
  commandId: string;
  cascade: SelectorCascade;
}

interface HoverOp {
  channel: 'runner-dom';
  op: 'hover';
  commandId: string;
  cascade: SelectorCascade;
}

interface FocusOp {
  channel: 'runner-dom';
  op: 'focus';
  commandId: string;
  cascade: SelectorCascade;
}

interface CountMatchingOp {
  channel: 'runner-dom';
  op: 'countMatching';
  commandId: string;
  cascade: SelectorCascade;
}

interface AnyMatchOp {
  channel: 'runner-dom';
  op: 'anyMatch';
  commandId: string;
  cascade: SelectorCascade;
}

interface ScrollOp {
  channel: 'runner-dom';
  op: 'scroll';
  commandId: string;
  direction: 'up' | 'down' | 'top' | 'bottom';
  amountPx?: number;
}

type RunnerDomMessage =
  | ClickOp
  | TypeOp
  | ExtractOp
  | WaitForSelectorOp
  | SelectOp
  | CheckOp
  | UncheckOp
  | HoverOp
  | FocusOp
  | CountMatchingOp
  | AnyMatchOp
  | ScrollOp;

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
// New operation handlers (task 8)
// ---------------------------------------------------------------------------

/**
 * waitForSelector — polls using requestAnimationFrame + MutationObserver.
 * Resolves when the element is found and visible (offsetParent !== null).
 */
function handleWaitForSelector(msg: WaitForSelectorOp): Promise<DomReply> {
  return new Promise<DomReply>((resolve) => {
    let settled = false;
    let rafHandle = 0;
    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function checkElement(): boolean {
      const el = resolveSelector(document, msg.cascade);
      return !!el && (el as HTMLElement).offsetParent !== null;
    }

    function found() {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(rafHandle);
      observer?.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      resolve({ ok: true });
    }

    function timedOut() {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(rafHandle);
      observer?.disconnect();
      resolve({ ok: false, code: 'wait_selector_timeout', message: 'wait_selector_timeout' });
    }

    function poll() {
      if (settled) return;
      if (checkElement()) {
        found();
      } else {
        rafHandle = requestAnimationFrame(poll);
      }
    }

    // MutationObserver as fast-path: fires synchronously on DOM changes
    observer = new MutationObserver(() => {
      if (!settled && checkElement()) found();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    // Also kick off a rAF loop in case the element is already present
    rafHandle = requestAnimationFrame(poll);

    // Hard timeout
    timer = setTimeout(timedOut, msg.timeoutMs);
  });
}

function handleSelect(msg: SelectOp): DomReply {
  const el = resolveSelector(document, msg.cascade);
  if (!el) {
    return { ok: false, code: 'selector_not_found', message: 'selector_not_found' };
  }
  if (!(el instanceof HTMLSelectElement)) {
    return { ok: false, code: 'element_not_select', message: 'element_not_select' };
  }
  // Check the value exists as an option
  const optionValues = Array.from(el.options).map((o) => o.value);
  if (!optionValues.includes(msg.value)) {
    return { ok: false, code: 'select_value_not_found', message: `Value "${msg.value}" not found in <select> options` };
  }
  el.value = msg.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

function handleCheck(msg: CheckOp): DomReply {
  const el = resolveSelector(document, msg.cascade);
  if (!el) {
    return { ok: false, code: 'selector_not_found', message: 'selector_not_found' };
  }
  if (!(el instanceof HTMLInputElement) || (el.type !== 'checkbox' && el.type !== 'radio')) {
    return { ok: false, code: 'element_not_checkable', message: 'element_not_checkable' };
  }
  el.checked = true;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

function handleUncheck(msg: UncheckOp): DomReply {
  const el = resolveSelector(document, msg.cascade);
  if (!el) {
    return { ok: false, code: 'selector_not_found', message: 'selector_not_found' };
  }
  if (!(el instanceof HTMLInputElement) || (el.type !== 'checkbox' && el.type !== 'radio')) {
    return { ok: false, code: 'element_not_checkable', message: 'element_not_checkable' };
  }
  if (el.type === 'radio') {
    return { ok: false, code: 'radio_cannot_uncheck', message: 'radio_cannot_uncheck' };
  }
  el.checked = false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

function handleHover(msg: HoverOp): DomReply {
  const el = resolveSelector(document, msg.cascade);
  if (!el) {
    return { ok: false, code: 'selector_not_found', message: 'selector_not_found' };
  }
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  return { ok: true };
}

function handleFocus(msg: FocusOp): DomReply {
  const el = resolveSelector(document, msg.cascade);
  if (!el) {
    return { ok: false, code: 'selector_not_found', message: 'selector_not_found' };
  }
  (el as HTMLElement).focus();
  return { ok: true };
}

function handleCountMatching(msg: CountMatchingOp): DomReply {
  // Use the primary selector for counting (cascade fallbacks not used for counting)
  const count = matchCount(document, msg.cascade.primary);
  return { ok: true, value: { count } };
}

function handleAnyMatch(msg: AnyMatchOp): DomReply {
  const count = matchCount(document, msg.cascade.primary);
  return { ok: true, value: { exists: count > 0 } };
}

function handleScroll(msg: ScrollOp): DomReply {
  const amount = msg.amountPx ?? 500;
  switch (msg.direction) {
    case 'up':
      window.scrollBy(0, -amount);
      break;
    case 'down':
      window.scrollBy(0, amount);
      break;
    case 'top':
      window.scrollTo(0, 0);
      break;
    case 'bottom':
      window.scrollTo(0, document.body.scrollHeight);
      break;
    default:
      return { ok: false, code: 'unknown_direction', message: `Unknown scroll direction: ${msg.direction}` };
  }
  return { ok: true };
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

    // waitForSelector is async — must return true to keep the channel open
    if (m.op === 'waitForSelector') {
      handleWaitForSelector(msg as WaitForSelectorOp)
        .then(sendResponse)
        .catch((err) => {
          sendResponse({
            ok: false,
            message: err instanceof Error ? err.message : String(err),
            code: 'internal_error',
          });
        });
      return true; // async reply
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
        case 'select':
          reply = handleSelect(msg as SelectOp);
          break;
        case 'check':
          reply = handleCheck(msg as CheckOp);
          break;
        case 'uncheck':
          reply = handleUncheck(msg as UncheckOp);
          break;
        case 'hover':
          reply = handleHover(msg as HoverOp);
          break;
        case 'focus':
          reply = handleFocus(msg as FocusOp);
          break;
        case 'countMatching':
          reply = handleCountMatching(msg as CountMatchingOp);
          break;
        case 'anyMatch':
          reply = handleAnyMatch(msg as AnyMatchOp);
          break;
        case 'scroll':
          reply = handleScroll(msg as ScrollOp);
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
