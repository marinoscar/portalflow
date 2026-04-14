# PortalFlow Extension Session Zip Format

This document is the authoritative reference for the session zip file produced
by the PortalFlow Chrome extension's **Export session (.zip)** button and
consumed by its **Import session** button. The Zod schema at
`tools/extension/src/sidepanel/services/session-manifest.ts` is the source of
truth for the manifest shape; this document describes the full archive.

A PortalFlow session zip is a portable snapshot of a recording workflow: the
raw events, every HTML snapshot the content script captured, the committed
automation versions, the AI chat history, and the head automation. Importing
a zip into another Chrome profile (or the same profile after a crash) fully
restores the session, not just the final automation.

---

## Why sessions are zippable

The extension keeps an in-progress session in `chrome.storage.local` under a
single key (`portalflow:session`). That key holds four things you usually
cannot round-trip from a plain `automation.json`:

1. The **raw original recording** as first converted from events — a read-only
   fallback the user can revert to after any amount of editing.
2. The **version history** — every committed change with its author (raw
   recording, manual edit, AI chat, or legacy AI Improve) and its message.
3. The **HTML snapshots** the content script captured at each recorded event,
   deduped by SHA-256 content hash.
4. The **AI chat history** including approved and rejected proposals.

None of the above are present in the automation JSON the CLI runs. The zip
format exists so you can pause editing on one machine and resume it on
another, archive a session for a retrospective, or share it with a teammate
for review.

---

## Archive layout

Every session zip has the following top-level structure. Paths use forward
slashes; file contents are UTF-8 unless otherwise noted.

```
portalflow-session-<slug>-<date>.zip
├── manifest.json              # SessionManifest (schemaVersion, counts, ids)
├── automation.json            # the current / head automation (convenience copy)
├── original/
│   └── automation.json        # the raw recording, never mutated; optional
├── versions/
│   ├── 0001-raw-recording.json
│   ├── 0002-user-edit.json
│   ├── 0003-ai-chat.json
│   └── ...
├── snapshots/
│   ├── <sha256>.html          # the simplified HTML body
│   └── <sha256>.meta.json     # url, title, capturedAt, sizeBytes sidecar
├── events.json                # the raw event log (carries snapshot references)
└── chat/
    └── history.json           # the AI chat thread
```

All JSON is pretty-printed (`JSON.stringify(value, null, 2)`) so the zip can
be inspected by hand without reformatting.

---

## manifest.json

The manifest is the first file the importer reads. It pins the archive's
schema version and carries counts for quick previews.

```typescript
interface SessionManifest {
  schemaVersion: 1;              // exact literal — importer rejects others
  sessionId: string;             // stable across export/import round-trips
  exportedAt: number;            // epoch ms at export time
  name: string;                  // the session's friendly name at export time
  currentVersionId: string | null; // the head version at export time
  counts: {
    versions: number;
    snapshots: number;
    events: number;
    chatMessages: number;
  };
}
```

**Validation rules:**

- `schemaVersion` must equal `1`. Future revisions will bump this integer and
  describe the changes in this document.
- `sessionId` is opaque — treat it as an identifier, not a path component.
- `currentVersionId` may be `null` if no version has been committed yet
  (impossible in practice since the extension auto-commits the raw recording,
  but the field is nullable for robustness).
- The `counts` block is advisory — the importer does not enforce that the
  actual file counts match, but it uses them for a quick sanity check.

If `manifest.json` is missing or fails validation, the importer throws:

```
Missing manifest.json — not a valid PortalFlow session zip.
manifest.json failed validation: <message>
```

---

## automation.json

A top-level `automation.json` file holds the head automation — exactly what
the session's reducer currently considers "the working state". This is a
convenience copy so tools that only care about the final automation can
unzip one file without walking the versions directory.

The file is validated against `AutomationSchema` from `@portalflow/schema`.
On validation failure:

```
automation.json failed schema validation: <path>: <message>
```

---

## original/automation.json (optional)

Present when the session has a frozen original recording (`session.original`).
Contains the automation as first converted from the raw events, byte-for-byte.
Never written after the first stop of the recording. Used by the "Revert to
original" button in the side panel.

This file is optional because a fresh session that has not been stopped yet
will not have an original. Sessions exported mid-recording still skip it.

---

## versions/NNNN-author.json

Every committed automation version is stored as a standalone JSON file in the
`versions/` directory. Filenames are ordinal-padded so a lexicographic sort
matches the chronological order.

The ordinal is a 4-digit counter starting at `0001`. The `author` suffix is
one of:

- `raw-recording`
- `user-edit`
- `ai-chat`
- `ai-improve-legacy`
- `import`

Each file contains a full `AutomationVersion`:

```typescript
interface AutomationVersion {
  id: string;
  createdAt: number;
  author: VersionAuthor;
  message: string;
  automation: Automation; // validated against AutomationSchema on import
}
```

**Why the full automation instead of a diff?** Diffs are cheaper on disk but
harder to reason about and more brittle during schema migrations. V1 stores
full snapshots and prunes the oldest non-pinned version when the in-memory
cap is reached (default 100). The raw-recording version at index 0 is
pinned and never pruned.

---

## snapshots/

The content script captures a simplified HTML snapshot at every recorded
event. Snapshots are deduped by SHA-256 content hash so identical consecutive
snapshots cost zero extra storage.

For each unique snapshot the zip contains two files:

- `<sha256>.html` — the simplified HTML body. Scripts, styles, noscript blocks,
  and hidden elements are already stripped. UTF-8 encoded, truncated to the
  extension's per-snapshot cap (default 200 KB).
- `<sha256>.meta.json` — a sidecar JSON with the `url`, `title`, `capturedAt`,
  `sizeBytes`, and `id` (the hash itself, duplicated for self-containment).

**Why the sidecar?** During import, we use the sidecar to reconstruct the
`HtmlSnapshot` object without re-hashing the content. If an HTML file is
present but its sidecar is missing, the importer skips it silently; if a
sidecar is present but its HTML file is missing, the entry is also skipped.

---

## events.json

The full event log in chronological order. Each event is a `RawEvent`
(click, type, navigate, select, check/uncheck, submit) and may carry a
`snapshotId` referencing one of the files under `snapshots/`.

The importer does not validate events against a schema beyond shape — event
kinds and field sets are considered stable across v1 archives.

---

## chat/history.json

The AI chat thread for this session, in oldest-first order. Each entry is a
`ChatMessage` with:

- `id`, `role`, `content`, `createdAt`
- Optional `proposal` with status `pending`, `approved`, or `rejected`
- Optional `parseError` for assistant messages whose structured proposal
  failed to parse

Approved proposals remain in the chat after approval — the side panel marks
them with a green "Applied" badge so the user can see the full conversation.

---

## Round-trip guarantees

The extension's test suite exercises `exportSession` followed by
`importSession` on a synthetic session with:

- 3 committed versions (one of each author type)
- 5 unique HTML snapshots
- 2 recorded events with snapshot references
- 2 chat messages including an approved proposal

After the round trip, every field is asserted to equal the original. If you
write a tool that produces or consumes session zips, use this test as a
compatibility reference.

---

## Hand-building a session zip

For testing or archival:

1. Start from a valid `automation.json` that passes `portalflow validate`.
2. Wrap it in a minimal `RecordingSession` with empty `events[]`, empty
   `snapshots`, and a single `versions[]` entry authored as `raw-recording`.
3. Serialize with `exportSession` from the extension's service module (or
   replicate the layout by hand, keeping filenames exactly as documented
   above).
4. Zip the result and open it via the extension's Import icon.

Any deviation from the filename conventions — wrong extension, missing
manifest, snapshot without a sidecar, malformed JSON — will be rejected at
import time with a descriptive error.

---

## Schema version history

- **Version 1** (current): initial release. Supports the shape documented
  above. Backwards-incompatible changes in future versions will bump
  `schemaVersion` and add migration notes to this section.
