import { loadSession, saveSession, updateSession } from '../storage/session.storage';
import type { Message } from '../shared/messaging';
import type { NavigateEvent, RawEvent, RecordingSession } from '../shared/types';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[PortalFlow] Extension installed');
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[PortalFlow] Failed to set panel behavior', err));

// --- Session helpers ---

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function startRecording(tabId: number): Promise<RecordingSession> {
  const session: RecordingSession = {
    id: makeId(),
    status: 'recording',
    startedAt: Date.now(),
    tabId,
    events: [],
    metadata: { name: '', goal: '', description: '' },
  };
  await saveSession(session);
  await broadcastSession(session);

  // Inject an initial navigate event so the recording starts from the current URL
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:')) {
      await appendEvent({
        kind: 'navigate',
        url: tab.url,
        title: tab.title ?? '',
        ts: Date.now(),
      });
    }
  } catch (err) {
    console.warn('[PortalFlow] Could not read initial tab', err);
  }

  return session;
}

async function stopRecording(): Promise<RecordingSession | null> {
  const updated = await updateSession((s) => ({
    ...s,
    status: 'stopped',
    endedAt: Date.now(),
  }));
  if (updated) await broadcastSession(updated);
  return updated;
}

async function pauseRecording(): Promise<RecordingSession | null> {
  const updated = await updateSession((s) =>
    s.status === 'recording' ? { ...s, status: 'paused' } : s,
  );
  if (updated) await broadcastSession(updated);
  return updated;
}

async function resumeRecording(): Promise<RecordingSession | null> {
  const updated = await updateSession((s) =>
    s.status === 'paused' ? { ...s, status: 'recording' } : s,
  );
  if (updated) await broadcastSession(updated);
  return updated;
}

async function clearSession(): Promise<void> {
  await saveSession(null);
  await broadcastSession(null);
}

async function appendEvent(event: RawEvent): Promise<void> {
  const session = await loadSession();
  if (!session || session.status !== 'recording') return;

  // De-dup consecutive navigate events to the same URL
  if (event.kind === 'navigate') {
    const last = session.events[session.events.length - 1];
    if (last && last.kind === 'navigate' && last.url === (event as NavigateEvent).url) {
      return;
    }
  }

  const next: RecordingSession = {
    ...session,
    events: [...session.events, event],
  };
  await saveSession(next);
  await broadcastSession(next);
}

async function broadcastSession(session: RecordingSession | null): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', session } satisfies Message);
  } catch {
    // Side panel may not be open — this is fine
  }
}

// --- Message routing ---

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'GET_SESSION_STATUS': {
        const session = await loadSession();
        sendResponse({ type: 'SESSION_STATUS_RESPONSE', session });
        return;
      }
      case 'START_RECORDING': {
        const session = await startRecording(msg.tabId);
        sendResponse({ type: 'SESSION_STATUS_RESPONSE', session });
        return;
      }
      case 'STOP_RECORDING': {
        const session = await stopRecording();
        sendResponse({ type: 'SESSION_STATUS_RESPONSE', session });
        return;
      }
      case 'PAUSE_RECORDING': {
        const session = await pauseRecording();
        sendResponse({ type: 'SESSION_STATUS_RESPONSE', session });
        return;
      }
      case 'RESUME_RECORDING': {
        const session = await resumeRecording();
        sendResponse({ type: 'SESSION_STATUS_RESPONSE', session });
        return;
      }
      case 'CLEAR_SESSION': {
        await clearSession();
        sendResponse({ type: 'SESSION_STATUS_RESPONSE', session: null });
        return;
      }
      case 'RECORDED_EVENT': {
        await appendEvent(msg.event);
        sendResponse({ ok: true });
        return;
      }
    }
  })().catch((err) => {
    console.error('[PortalFlow] Message handler error', err);
    sendResponse({ error: String(err) });
  });

  return true; // keep sendResponse async
});

// --- Navigation tracking: auto-emit navigate events during active recording ---

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only top frame (frameId === 0) during active recording on the recorded tab
  if (details.frameId !== 0) return;
  if (details.url.startsWith('chrome://') || details.url.startsWith('about:')) return;

  const session = await loadSession();
  if (!session || session.status !== 'recording') return;
  if (session.tabId !== details.tabId) return;

  let title = '';
  try {
    const tab = await chrome.tabs.get(details.tabId);
    title = tab.title ?? '';
  } catch {
    // ignore
  }

  await appendEvent({
    kind: 'navigate',
    url: details.url,
    title,
    ts: Date.now(),
  });
});

export {};
