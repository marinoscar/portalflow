import { unzip, strFromU8 } from 'fflate';
import { AutomationSchema, type Automation } from '@portalflow/schema';
import type {
  AutomationVersion,
  ChatMessage,
  HtmlSnapshot,
  RawEvent,
  RecordingSession,
} from '../../shared/types';
import {
  SessionManifestSchema,
  type SessionManifest,
} from './session-manifest';

/** Shape returned by importSession — a fully hydrated session ready to save. */
export interface ImportedSession {
  session: RecordingSession;
  manifest: SessionManifest;
  currentAutomation: Automation;
  currentVersionId: string | null;
}

/**
 * Parse a zip file produced by `exportSession` and reconstruct the
 * RecordingSession shape. Throws on malformed input with a descriptive
 * error; callers should surface the message in a modal instead of
 * silently failing. Accepts any Blob-like source (File, Blob, or a raw
 * Uint8Array / ArrayBuffer) so the tests can bypass jsdom's incomplete
 * File.arrayBuffer implementation.
 */
export async function importSession(
  source: Blob | ArrayBuffer | Uint8Array,
): Promise<ImportedSession> {
  let bytes: Uint8Array;
  if (source instanceof Uint8Array) {
    bytes = source;
  } else if (source instanceof ArrayBuffer) {
    bytes = new Uint8Array(source);
  } else {
    bytes = new Uint8Array(await source.arrayBuffer());
  }

  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  // ---- manifest ------------------------------------------------------
  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) {
    throw new Error('Missing manifest.json — not a valid PortalFlow session zip.');
  }
  const manifestParsed = safeParseJson(manifestRaw, 'manifest.json');
  const manifestResult = SessionManifestSchema.safeParse(manifestParsed);
  if (!manifestResult.success) {
    throw new Error(
      `manifest.json failed validation: ${manifestResult.error.issues[0]?.message ?? 'unknown error'}`,
    );
  }
  const manifest = manifestResult.data;

  // ---- current automation -------------------------------------------
  const automationRaw = files['automation.json'];
  if (!automationRaw) {
    throw new Error('Missing automation.json — session zip is incomplete.');
  }
  const automationParsed = safeParseJson(automationRaw, 'automation.json');
  const automationResult = AutomationSchema.safeParse(automationParsed);
  if (!automationResult.success) {
    throw new Error(
      `automation.json failed schema validation: ${automationResult.error.issues[0]?.message ?? 'unknown error'}`,
    );
  }
  const currentAutomation = automationResult.data;

  // ---- original (optional) ------------------------------------------
  let original: Automation | undefined;
  const originalRaw = files['original/automation.json'];
  if (originalRaw) {
    const parsed = safeParseJson(originalRaw, 'original/automation.json');
    const result = AutomationSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `original/automation.json failed validation: ${result.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }
    original = result.data;
  }

  // ---- versions ------------------------------------------------------
  const versions: AutomationVersion[] = [];
  const versionKeys = Object.keys(files)
    .filter((k) => k.startsWith('versions/') && k.endsWith('.json'))
    .sort();
  for (const key of versionKeys) {
    const parsed = safeParseJson(files[key], key);
    // Validate the shape: { id, createdAt, author, message, automation }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { id?: unknown }).id !== 'string' ||
      typeof (parsed as { message?: unknown }).message !== 'string'
    ) {
      throw new Error(`${key} has an invalid shape.`);
    }
    const obj = parsed as {
      id: string;
      createdAt: number;
      author: string;
      message: string;
      automation: unknown;
    };
    const automationCheck = AutomationSchema.safeParse(obj.automation);
    if (!automationCheck.success) {
      throw new Error(
        `${key}.automation failed schema validation: ${automationCheck.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }
    versions.push({
      id: obj.id,
      createdAt: obj.createdAt,
      author: obj.author as AutomationVersion['author'],
      message: obj.message,
      automation: automationCheck.data,
    });
  }

  // ---- snapshots -----------------------------------------------------
  const snapshots: Record<string, HtmlSnapshot> = {};
  const metaKeys = Object.keys(files).filter(
    (k) => k.startsWith('snapshots/') && k.endsWith('.meta.json'),
  );
  for (const metaKey of metaKeys) {
    const metaParsed = safeParseJson(files[metaKey], metaKey);
    if (!metaParsed || typeof metaParsed !== 'object') continue;
    const meta = metaParsed as Partial<HtmlSnapshot>;
    if (typeof meta.id !== 'string') continue;

    const htmlKey = `snapshots/${meta.id}.html`;
    const htmlRaw = files[htmlKey];
    if (!htmlRaw) continue;
    const content = strFromU8(htmlRaw);

    snapshots[meta.id] = {
      id: meta.id,
      url: meta.url ?? '',
      title: meta.title ?? '',
      capturedAt: typeof meta.capturedAt === 'number' ? meta.capturedAt : Date.now(),
      sizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : content.length,
      content,
    };
  }

  // ---- events --------------------------------------------------------
  const eventsRaw = files['events.json'];
  const events: RawEvent[] = eventsRaw
    ? (safeParseJson(eventsRaw, 'events.json') as RawEvent[])
    : [];

  // ---- chat ----------------------------------------------------------
  const chatRaw = files['chat/history.json'];
  const chatHistory: ChatMessage[] = chatRaw
    ? (safeParseJson(chatRaw, 'chat/history.json') as ChatMessage[])
    : [];

  // ---- assemble RecordingSession ------------------------------------
  const session: RecordingSession = {
    id: manifest.sessionId,
    status: 'stopped',
    startedAt: manifest.exportedAt,
    endedAt: manifest.exportedAt,
    events,
    metadata: {
      name: manifest.name,
      goal: currentAutomation.goal,
      description: currentAutomation.description,
    },
    snapshots,
    original,
    versions,
    currentVersionId: manifest.currentVersionId ?? undefined,
    chatHistory,
  };

  return {
    session,
    manifest,
    currentAutomation,
    currentVersionId: manifest.currentVersionId,
  };
}

function safeParseJson(bytes: Uint8Array, filename: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch (err) {
    throw new Error(`Failed to parse ${filename}: ${String(err)}`);
  }
}
