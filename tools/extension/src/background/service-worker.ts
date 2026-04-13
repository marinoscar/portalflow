import { loadSession, saveSession, updateSession } from '../storage/session.storage';
import type { Message } from '../shared/messaging';
import type { HtmlSnapshot, NavigateEvent, RawEvent, RecordingSession } from '../shared/types';
import { LlmService } from '../llm/llm.service';
import { PROMPTS } from '../llm/prompts';

const llmService = new LlmService();

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

async function appendEvent(
  event: RawEvent,
  snapshot?: HtmlSnapshot,
): Promise<void> {
  const session = await loadSession();
  if (!session || session.status !== 'recording') return;

  // De-dup consecutive navigate events to the same URL
  if (event.kind === 'navigate') {
    const last = session.events[session.events.length - 1];
    if (last && last.kind === 'navigate' && last.url === (event as NavigateEvent).url) {
      return;
    }
  }

  // Merge the snapshot into the session's snapshots map if it's new.
  // Identical consecutive snapshots (same hash) cost zero extra storage.
  let snapshots = session.snapshots;
  if (snapshot) {
    if (!snapshots || !snapshots[snapshot.id]) {
      snapshots = {
        ...(snapshots ?? {}),
        [snapshot.id]: {
          id: snapshot.id,
          content: snapshot.content,
          sizeBytes: snapshot.sizeBytes,
          url: snapshot.url,
          title: snapshot.title,
          capturedAt: snapshot.capturedAt ?? Date.now(),
        },
      };
    }
  }

  const next: RecordingSession = {
    ...session,
    events: [...session.events, event],
    ...(snapshots ? { snapshots } : {}),
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
        await appendEvent(msg.event, msg.snapshot);
        sendResponse({ ok: true });
        return;
      }
      case 'LLM_IMPROVE_SELECTOR': {
        try {
          const result = await llmService.complete({
            system: PROMPTS.improveSelector.system,
            user: `Step: ${msg.stepDescription}\nCurrent selector: ${msg.currentSelector}`,
          });
          const parsed = tryParseJson(result.text);
          sendResponse({
            type: 'LLM_RESULT',
            ok: true,
            data: parsed ?? { primary: msg.currentSelector, fallbacks: [] },
          });
        } catch (err) {
          sendResponse({ type: 'LLM_ERROR', ok: false, error: String(err) });
        }
        return;
      }
      case 'LLM_GENERATE_GUIDANCE': {
        try {
          const result = await llmService.complete({
            system: PROMPTS.generateGuidance.system,
            user: msg.stepDescription,
          });
          sendResponse({ type: 'LLM_RESULT', ok: true, data: result.text.trim() });
        } catch (err) {
          sendResponse({ type: 'LLM_ERROR', ok: false, error: String(err) });
        }
        return;
      }
      case 'LLM_POLISH_METADATA': {
        try {
          const stepSummary = msg.steps
            .map((s, i) => `${i + 1}. [${s.type}] ${s.name}`)
            .join('\n');
          const result = await llmService.complete({
            system: PROMPTS.polishMetadata.system,
            user: `Steps:\n${stepSummary}`,
            maxTokens: 16384,
          });
          const parsed = tryParseJson(result.text);
          sendResponse({ type: 'LLM_RESULT', ok: true, data: parsed });
        } catch (err) {
          sendResponse({ type: 'LLM_ERROR', ok: false, error: String(err) });
        }
        return;
      }
      case 'LLM_IMPROVE_STEPS': {
        try {
          const a = msg.automation;

          const inputsSummary = (a.inputs ?? [])
            .map(
              (i) =>
                `- ${i.name} (type: ${i.type}, source: ${i.source ?? 'literal'}${
                  i.description ? `, description: ${i.description}` : ''
                })`,
            )
            .join('\n') || '(none)';

          const toolsSummary = (a.tools ?? []).map((t) => `- ${t.name}`).join('\n') || '(none)';

          const outputsSummary = (a.outputs ?? [])
            .map((o) => `- ${o.name} (${o.type})`)
            .join('\n') || '(none)';

          const stepsJson = JSON.stringify(a.steps, null, 2);

          const userPrompt =
            `# Automation to improve\n\n` +
            `Name: ${a.name}\n` +
            `Version: ${a.version}\n` +
            `Goal: ${a.goal}\n` +
            `Description: ${a.description}\n\n` +
            `## Inputs (you must not rename these; type steps may reference them via inputRef)\n` +
            `${inputsSummary}\n\n` +
            `## Tools configured\n` +
            `${toolsSummary}\n\n` +
            `## Outputs declared\n` +
            `${outputsSummary}\n\n` +
            `## Current steps (${a.steps.length} total, as JSON)\n\n` +
            '```json\n' +
            `${stepsJson}\n` +
            '```\n\n' +
            `Now produce the improved steps array and the changes list. Take your time and be thorough.`;

          const result = await llmService.complete({
            system: PROMPTS.improveSteps.system,
            user: userPrompt,
            maxTokens: 16384,
          });

          const parsed = tryParseJson(result.text);
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            !('steps' in parsed) ||
            !Array.isArray((parsed as { steps: unknown }).steps)
          ) {
            throw new Error('LLM did not return a valid { steps: [...] } object');
          }

          sendResponse({ type: 'LLM_RESULT', ok: true, data: parsed });
        } catch (err) {
          sendResponse({ type: 'LLM_ERROR', ok: false, error: String(err) });
        }
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

function tryParseJson(text: string): unknown {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract a JSON object from the text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export {};
