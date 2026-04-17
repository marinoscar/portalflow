/**
 * run-window.ts — tracks the single dedicated automation window.
 *
 * During a run, the extension opens one Chrome window exclusively for
 * automation commands. This module owns the window/tab IDs and broadcasts
 * unsolicited windowClosed / tabClosed events to the CLI when the user closes
 * that window or its tab out of band.
 */

import type { RunnerEvent } from '../shared/runner-protocol';

// ---------------------------------------------------------------------------
// Module-local state
// ---------------------------------------------------------------------------

let currentRunWindowId: number | null = null;
let currentRunTabId: number | null = null;

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getRunWindowId(): number | null {
  return currentRunWindowId;
}

export function getRunTabId(): number | null {
  return currentRunTabId;
}

// ---------------------------------------------------------------------------
// Event forwarding to CLI via offscreen document
// ---------------------------------------------------------------------------

/**
 * Posts an unsolicited RunnerEvent to the offscreen document, which forwards
 * it over the WebSocket to the CLI.
 */
export function emitUnsolicitedEvent(event: RunnerEvent): void {
  chrome.runtime.sendMessage({ channel: 'runner-event', event }).catch((err: unknown) => {
    console.warn('[run-window] emitUnsolicitedEvent: sendMessage failed:', err);
  });
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/**
 * Opens a new dedicated run window and records its ids.
 * If a run window is already open, closes it first (defensive — v1 is single-run).
 */
export async function openRunWindow(opts: { focused: boolean }): Promise<{ windowId: number; tabId: number }> {
  if (currentRunWindowId !== null) {
    console.warn(
      '[run-window] openRunWindow called while a run window is already open (windowId=%d) — closing it first',
      currentRunWindowId,
    );
    await closeRunWindow();
  }

  const win = await chrome.windows.create({ url: 'about:blank', type: 'normal', focused: opts.focused });

  const windowId = win?.id;
  const tabId = win?.tabs?.[0]?.id;

  if (windowId == null || tabId == null) {
    throw new Error('[run-window] chrome.windows.create returned a window without id or tabs');
  }

  currentRunWindowId = windowId;
  currentRunTabId = tabId;

  console.log('[run-window] run window opened', { windowId, tabId });

  return { windowId, tabId };
}

/**
 * Closes the run window.
 * If `windowId` is provided and does not match the tracked window, logs a
 * warning and no-ops. Swallows errors (the window may already be gone).
 */
export async function closeRunWindow(windowId?: number): Promise<void> {
  if (currentRunWindowId === null) {
    // Nothing to close.
    return;
  }

  if (windowId !== undefined && windowId !== currentRunWindowId) {
    console.warn(
      '[run-window] closeRunWindow called with windowId=%d but current run window is %d — ignoring',
      windowId,
      currentRunWindowId,
    );
    return;
  }

  const idToClose = currentRunWindowId;
  // Clear state before the async call so re-entrant calls are safe.
  currentRunWindowId = null;
  currentRunTabId = null;

  try {
    await chrome.windows.remove(idToClose);
    console.log('[run-window] run window closed', { windowId: idToClose });
  } catch (err: unknown) {
    // The window may already be closed by the user — this is expected.
    console.warn('[run-window] closeRunWindow: chrome.windows.remove failed (may already be closed):', err);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle listeners — registered once at module load
// ---------------------------------------------------------------------------

chrome.windows.onRemoved.addListener((closedId: number) => {
  if (closedId !== currentRunWindowId) return;

  console.log('[run-window] run window removed by user', { windowId: closedId });
  currentRunWindowId = null;
  currentRunTabId = null;

  emitUnsolicitedEvent({ kind: 'event', type: 'windowClosed', windowId: closedId });
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (tabId !== currentRunTabId) return;

  console.log('[run-window] run tab closed by user', { tabId });
  // Keep currentRunWindowId — the window may still be open.
  currentRunTabId = null;

  emitUnsolicitedEvent({ kind: 'event', type: 'tabClosed', tabId });
});
