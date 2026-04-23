/**
 * Verifies that runner-bootstrap.ts registers declarative chrome.windows.onCreated
 * and chrome.tabs.onCreated listeners on module load. MV3 caches these declarative
 * registrations and uses them to wake the service worker when Chrome opens a new
 * window while already running (the `portalflow run` use-case where `onStartup`
 * does not fire).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal chrome API stub — covers the surface used by runner-bootstrap.ts
// and its transitive imports (run-window.ts, dispatch handlers).
// ---------------------------------------------------------------------------

function makeEventStub() {
  return { addListener: vi.fn() };
}

const chromeMock = {
  offscreen: {
    hasDocument: vi.fn(async () => false),
    createDocument: vi.fn(async () => undefined),
    Reason: { WORKERS: 'WORKERS', BLOBS: 'BLOBS' },
  },
  runtime: {
    onStartup: makeEventStub(),
    onInstalled: makeEventStub(),
    onMessage: makeEventStub(),
    sendMessage: vi.fn(async () => undefined),
  },
  windows: {
    onCreated: makeEventStub(),
    onRemoved: makeEventStub(),
    create: vi.fn(async () => ({ id: 1, tabs: [{ id: 10 }] })),
    remove: vi.fn(async () => undefined),
  },
  tabs: {
    onCreated: makeEventStub(),
    onRemoved: makeEventStub(),
  },
  webNavigation: {
    onCommitted: makeEventStub(),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
};

// Install the mock as a global before the module is imported.
beforeEach(() => {
  vi.stubGlobal('chrome', chromeMock);
  // Reset modules so each test gets a fresh import (and fresh addListener calls).
  vi.resetModules();
  // Reset call counts on the stubs.
  for (const stub of [
    chromeMock.windows.onCreated,
    chromeMock.windows.onRemoved,
    chromeMock.tabs.onCreated,
    chromeMock.tabs.onRemoved,
    chromeMock.runtime.onStartup,
    chromeMock.runtime.onInstalled,
    chromeMock.runtime.onMessage,
    chromeMock.webNavigation.onCommitted,
  ]) {
    stub.addListener.mockClear();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runner-bootstrap listener registration', () => {
  it('registers a chrome.windows.onCreated listener on module load', async () => {
    await import('./runner-bootstrap');
    expect(chromeMock.windows.onCreated.addListener).toHaveBeenCalledOnce();
  });

  it('registers a chrome.tabs.onCreated listener on module load', async () => {
    await import('./runner-bootstrap');
    expect(chromeMock.tabs.onCreated.addListener).toHaveBeenCalledOnce();
  });

  it('registers chrome.runtime.onStartup and onInstalled listeners on module load', async () => {
    await import('./runner-bootstrap');
    expect(chromeMock.runtime.onStartup.addListener).toHaveBeenCalledOnce();
    expect(chromeMock.runtime.onInstalled.addListener).toHaveBeenCalledOnce();
  });
});
