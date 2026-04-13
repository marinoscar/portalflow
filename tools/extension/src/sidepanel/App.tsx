import { useEffect, useState } from 'react';
import { sendMessage } from '../shared/messaging';
import type { RecordingSession, RawEvent } from '../shared/types';
import type { Message } from '../shared/messaging';
import './app.css';

export function App() {
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    sendMessage<{ session: RecordingSession | null }>({ type: 'GET_SESSION_STATUS' })
      .then((resp) => {
        if (mounted) {
          setSession(resp?.session ?? null);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('[PortalFlow] Failed to load session', err);
        if (mounted) setLoading(false);
      });

    const listener = (msg: Message) => {
      if (msg.type === 'SESSION_UPDATED') {
        setSession(msg.session);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      mounted = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const start = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      alert('No active tab found');
      return;
    }
    const resp = await sendMessage<{ session: RecordingSession }>({
      type: 'START_RECORDING',
      tabId: tab.id,
    });
    setSession(resp.session);
  };

  const stop = async () => {
    const resp = await sendMessage<{ session: RecordingSession }>({ type: 'STOP_RECORDING' });
    setSession(resp.session);
  };

  const pause = async () => {
    const resp = await sendMessage<{ session: RecordingSession }>({ type: 'PAUSE_RECORDING' });
    setSession(resp.session);
  };

  const resume = async () => {
    const resp = await sendMessage<{ session: RecordingSession }>({ type: 'RESUME_RECORDING' });
    setSession(resp.session);
  };

  const clear = async () => {
    await sendMessage({ type: 'CLEAR_SESSION' });
    setSession(null);
  };

  if (loading) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>PortalFlow Recorder</h1>
        </header>
        <main className="app-main">
          <p>Loading...</p>
        </main>
      </div>
    );
  }

  const status = session?.status ?? 'idle';
  const eventCount = session?.events.length ?? 0;

  return (
    <div className="app">
      <header className="app-header">
        <h1>PortalFlow Recorder</h1>
        <span className={`status-pill status-${status}`}>{status}</span>
      </header>
      <main className="app-main">
        <div className="controls">
          {status === 'idle' && (
            <button className="btn-primary" onClick={start}>
              Start Recording
            </button>
          )}
          {status === 'recording' && (
            <>
              <button className="btn-secondary" onClick={pause}>
                Pause
              </button>
              <button className="btn-primary" onClick={stop}>
                Stop
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button className="btn-primary" onClick={resume}>
                Resume
              </button>
              <button className="btn-secondary" onClick={stop}>
                Stop
              </button>
            </>
          )}
          {status === 'stopped' && (
            <>
              <button className="btn-primary" onClick={start}>
                Start New Recording
              </button>
              <button className="btn-secondary" onClick={clear}>
                Clear
              </button>
            </>
          )}
        </div>
        <div className="event-counter">
          {eventCount} {eventCount === 1 ? 'event' : 'events'} captured
        </div>
        <ol className="event-list">
          {(session?.events ?? []).map((event, idx) => (
            <li key={idx} className="event-row">
              <EventRow event={event} index={idx + 1} />
            </li>
          ))}
        </ol>
        {status === 'idle' && (
          <p className="hint">
            The editor UI, step conversion, and export are added in Phase 3 and Phase 4. This panel
            currently shows the raw event stream to verify the recording pipeline.
          </p>
        )}
      </main>
    </div>
  );
}

function EventRow({ event, index }: { event: RawEvent; index: number }) {
  const label = describe(event);
  return (
    <div>
      <span className="event-index">#{index}</span>
      <span className="event-kind">{event.kind}</span>
      <span className="event-label">{label}</span>
    </div>
  );
}

function describe(event: RawEvent): string {
  switch (event.kind) {
    case 'navigate':
      return event.url;
    case 'click':
      return event.elementText || event.selector;
    case 'type':
      return event.isSensitive
        ? `(${event.fieldKind} field)`
        : `"${event.value.slice(0, 40)}"`;
    case 'select':
      return `${event.selector} = ${event.value}`;
    case 'check':
    case 'uncheck':
      return event.selector;
    case 'submit':
      return event.selector;
  }
}
