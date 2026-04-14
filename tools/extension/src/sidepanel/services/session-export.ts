import { zip, strToU8 } from 'fflate';
import type { RecordingSession } from '../../shared/types';
import type { Automation } from '@portalflow/schema';
import type { AutomationVersion, ChatMessage } from '../../shared/types';
import {
  CURRENT_SESSION_SCHEMA_VERSION,
  type SessionManifest,
} from './session-manifest';

/**
 * Serialize a RecordingSession into a zip file layout that can be
 * round-tripped via `importSession`. Structure:
 *
 *   manifest.json             — session metadata + counts
 *   automation.json           — current (head) automation (convenience copy)
 *   original/automation.json  — raw recording, never mutated
 *   versions/NNNN-<author>.json — every committed version in order
 *   snapshots/<sha256>.html   — every unique HTML snapshot
 *   events.json               — raw event log (carries snapshot references)
 *   chat/history.json         — chat thread
 *
 * All JSON is pretty-printed for human inspection.
 */
export async function exportSession(
  session: RecordingSession,
  currentAutomation: Automation,
  currentVersionId: string | null,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};

  const versions = session.versions ?? [];
  const snapshots = session.snapshots ?? {};
  const chatHistory = session.chatHistory ?? [];

  const manifest: SessionManifest = {
    schemaVersion: CURRENT_SESSION_SCHEMA_VERSION,
    sessionId: session.id,
    exportedAt: Date.now(),
    name: session.metadata.name || currentAutomation.name,
    currentVersionId,
    counts: {
      versions: versions.length,
      snapshots: Object.keys(snapshots).length,
      events: session.events.length,
      chatMessages: chatHistory.length,
    },
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['automation.json'] = strToU8(JSON.stringify(currentAutomation, null, 2));

  if (session.original) {
    files['original/automation.json'] = strToU8(
      JSON.stringify(session.original, null, 2),
    );
  }

  versions.forEach((v, i) => {
    const ordinal = String(i + 1).padStart(4, '0');
    const name = `versions/${ordinal}-${sanitizeAuthor(v.author)}.json`;
    files[name] = strToU8(JSON.stringify(versionEntry(v), null, 2));
  });

  for (const [id, snap] of Object.entries(snapshots)) {
    files[`snapshots/${id}.html`] = strToU8(snap.content);
    // Also store the snapshot metadata — url/title/capturedAt — in a
    // sidecar JSON so it can be restored without re-hashing. The filename
    // itself is the hash.
    files[`snapshots/${id}.meta.json`] = strToU8(
      JSON.stringify(
        {
          id: snap.id,
          url: snap.url,
          title: snap.title,
          capturedAt: snap.capturedAt,
          sizeBytes: snap.sizeBytes,
        },
        null,
        2,
      ),
    );
  }

  files['events.json'] = strToU8(JSON.stringify(session.events, null, 2));
  files['chat/history.json'] = strToU8(JSON.stringify(chatHistory, null, 2));

  return new Promise<Blob>((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      // Explicitly narrow to a plain ArrayBuffer to satisfy the lib.dom
      // BlobPart type, which excludes SharedArrayBuffer-backed views.
      const buf = new Uint8Array(data).slice().buffer;
      resolve(new Blob([buf], { type: 'application/zip' }));
    });
  });
}

function sanitizeAuthor(author: string): string {
  return author.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Strip the inline Automation inside a version entry for a separate file
 * path (we keep it inline for simplicity). Returns the full entry so the
 * zip contains the same data the runtime holds.
 */
function versionEntry(v: AutomationVersion): AutomationVersion {
  return {
    id: v.id,
    createdAt: v.createdAt,
    author: v.author,
    message: v.message,
    automation: v.automation,
  };
}

/** Convenience: turn a chat history into a human-readable transcript. */
export function chatToText(history: ChatMessage[]): string {
  return history
    .map((m) => `[${m.role}] ${m.content}${m.proposal ? '\n(proposal attached)' : ''}`)
    .join('\n\n');
}
