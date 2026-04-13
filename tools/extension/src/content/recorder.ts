import { buildSelector } from './selector-builder';
import { isPasswordField } from './detectors/credential-detector';
import { isOtpField } from './detectors/otp-detector';
import { sendMessage } from '../shared/messaging';
import { captureSnapshot } from './snapshot';
import type { FieldKind, RawEvent, RecordingSession } from '../shared/types';

const SESSION_KEY = 'portalflow:session';
const TYPING_IDLE_MS = 1000;

let active = false;
let currentSession: RecordingSession | null = null;

// Typing state: collapse consecutive inputs on the same element into one TypeEvent
let typingElement: HTMLElement | null = null;
let typingTimer: number | null = null;
let typingValue = '';

function classifyField(el: HTMLInputElement): FieldKind {
  if (isPasswordField(el)) return 'password';
  if (isOtpField(el)) return 'otp';
  return 'normal';
}

async function emit(event: RawEvent) {
  let snapshotResult: Awaited<ReturnType<typeof captureSnapshot>> | undefined;
  try {
    snapshotResult = await captureSnapshot();
  } catch (err) {
    console.warn('[PortalFlow] Snapshot capture failed', err);
  }

  const eventWithSnapshot: RawEvent = snapshotResult
    ? { ...event, snapshotId: snapshotResult.id }
    : event;

  // Promote the capture-time fields into a full HtmlSnapshot with a
  // capturedAt timestamp the service worker will use as the first-seen time.
  const snapshot = snapshotResult
    ? {
        id: snapshotResult.id,
        content: snapshotResult.content,
        sizeBytes: snapshotResult.sizeBytes,
        url: snapshotResult.url,
        title: snapshotResult.title,
        capturedAt: Date.now(),
      }
    : undefined;

  sendMessage({
    type: 'RECORDED_EVENT',
    event: eventWithSnapshot,
    snapshot,
  }).catch((err) => {
    console.error('[PortalFlow] Failed to send event', err);
  });
}

function flushTyping() {
  if (!typingElement || typingTimer === null) return;
  window.clearTimeout(typingTimer);
  typingTimer = null;

  const el = typingElement;
  const value = typingValue;
  typingElement = null;
  typingValue = '';

  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;

  const { primary, fallbacks } = buildSelector(el);
  const fieldKind = el instanceof HTMLInputElement ? classifyField(el) : 'normal';
  const isSensitive = fieldKind !== 'normal';

  const sanitizedValue = isSensitive ? '' : value;

  emit({
    kind: 'type',
    selector: primary,
    fallbacks,
    value: sanitizedValue,
    isSensitive,
    fieldKind,
    ts: Date.now(),
    url: location.href,
    title: document.title,
  });
}

function scheduleTypingFlush() {
  if (typingTimer !== null) window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(flushTyping, TYPING_IDLE_MS);
}

// --- Event handlers ---

function handleClick(ev: MouseEvent) {
  if (!active) return;
  const target = ev.target as Element | null;
  if (!target || !(target instanceof Element)) return;

  // Resolve to the nearest button/link/clickable ancestor for better semantics
  const clickable = (target.closest('button, a, [role="button"]') as Element | null) ?? target;

  flushTyping(); // commit any in-flight typing first

  const { primary, fallbacks } = buildSelector(clickable);
  const isSubmit =
    (clickable instanceof HTMLButtonElement && clickable.type === 'submit') ||
    (clickable instanceof HTMLInputElement && clickable.type === 'submit');

  const text = (clickable.textContent ?? '').trim().slice(0, 100);

  emit({
    kind: 'click',
    selector: primary,
    fallbacks,
    elementTag: clickable.tagName.toLowerCase(),
    elementText: text || undefined,
    isSubmitButton: isSubmit,
    ts: Date.now(),
    url: location.href,
    title: document.title,
  });
}

function handleInput(ev: Event) {
  if (!active) return;
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  // Ignore checkboxes/radios/files here — they go through 'change'
  if (target instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(target.type)) {
    return;
  }

  if (typingElement !== target) {
    flushTyping();
    typingElement = target;
  }
  typingValue = target.value;
  scheduleTypingFlush();
}

function handleChange(ev: Event) {
  if (!active) return;
  const target = ev.target as HTMLElement | null;
  if (!target) return;

  if (target instanceof HTMLSelectElement) {
    flushTyping();
    const { primary, fallbacks } = buildSelector(target);
    emit({
      kind: 'select',
      selector: primary,
      fallbacks,
      value: target.value,
      ts: Date.now(),
      url: location.href,
      title: document.title,
    });
    return;
  }

  if (
    target instanceof HTMLInputElement &&
    (target.type === 'checkbox' || target.type === 'radio')
  ) {
    flushTyping();
    const { primary, fallbacks } = buildSelector(target);
    emit({
      kind: target.checked ? 'check' : 'uncheck',
      selector: primary,
      fallbacks,
      ts: Date.now(),
      url: location.href,
      title: document.title,
    });
  }
}

function handleSubmit(ev: Event) {
  if (!active) return;
  const target = ev.target as Element | null;
  if (!target || !(target instanceof HTMLFormElement)) return;

  flushTyping();

  const { primary, fallbacks } = buildSelector(target);
  emit({
    kind: 'submit',
    selector: primary,
    fallbacks,
    ts: Date.now(),
    url: location.href,
    title: document.title,
  });
}

function handleBeforeUnload() {
  if (!active) return;
  flushTyping();
}

// --- Lifecycle ---

function attach() {
  if (active) return;
  active = true;
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('submit', handleSubmit, true);
  window.addEventListener('beforeunload', handleBeforeUnload);
  console.log('[PortalFlow] Recording attached');
}

function detach() {
  if (!active) return;
  active = false;
  flushTyping();
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('submit', handleSubmit, true);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  console.log('[PortalFlow] Recording detached');
}

function syncFromSession(session: RecordingSession | null) {
  currentSession = session;
  if (session && session.status === 'recording') {
    attach();
  } else {
    detach();
  }
}

// Check current session on load
chrome.storage.local.get(SESSION_KEY, (result) => {
  syncFromSession((result[SESSION_KEY] as RecordingSession | null) ?? null);
});

// React to session changes (start/stop/pause from the UI)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (SESSION_KEY in changes) {
    const newValue = changes[SESSION_KEY]?.newValue as RecordingSession | null | undefined;
    syncFromSession(newValue ?? null);
  }
});

// Suppress unused variable warning — currentSession is read by syncFromSession
void currentSession;

console.log('[PortalFlow] Content script loaded on', location.href);

export {};
