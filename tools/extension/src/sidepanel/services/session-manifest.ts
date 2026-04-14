import { z } from 'zod';

/**
 * Top-level metadata file inside a session zip. Contains the session id,
 * the schema version, export timestamp, and counts for quick previews
 * before the full contents are unpacked.
 */
export const SessionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  exportedAt: z.number().int(),
  name: z.string(),
  currentVersionId: z.string().nullable(),
  counts: z.object({
    versions: z.number().int().min(0),
    snapshots: z.number().int().min(0),
    events: z.number().int().min(0),
    chatMessages: z.number().int().min(0),
  }),
});

export type SessionManifest = z.infer<typeof SessionManifestSchema>;

export const CURRENT_SESSION_SCHEMA_VERSION = 1;
