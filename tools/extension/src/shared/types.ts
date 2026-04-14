import type { Automation } from '@portalflow/schema';

/** The raw event kinds the recorder emits. */
export type RawEventKind =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'submit';

export type FieldKind = 'password' | 'otp' | 'normal';

/**
 * A simplified HTML snapshot of the page captured at the moment a recorder
 * event was emitted. Stored once per unique content hash — identical
 * consecutive snapshots on a static page produce only one entry.
 */
export interface HtmlSnapshot {
  /** SHA-256 hex digest of `content`. Doubles as the dedupe key. */
  id: string;
  url: string;
  title: string;
  /** Epoch ms of the first time this snapshot was seen in the session. */
  capturedAt: number;
  /** Byte length of `content`, for quick quota budgeting. */
  sizeBytes: number;
  /** Simplified HTML: scripts/styles/hidden elements/comments stripped. */
  content: string;
}

interface BaseEvent {
  ts: number;
  url: string;
  title: string;
  /**
   * Reference to the HtmlSnapshot captured for this event. Optional for
   * back-compat with sessions recorded before snapshot capture landed.
   */
  snapshotId?: string;
}

export interface NavigateEvent extends BaseEvent {
  kind: 'navigate';
}

export interface ClickEvent extends BaseEvent {
  kind: 'click';
  selector: string;
  fallbacks: string[];
  elementTag: string;
  elementText?: string;
  isSubmitButton: boolean;
}

export interface TypeEvent extends BaseEvent {
  kind: 'type';
  selector: string;
  fallbacks: string[];
  value: string;
  isSensitive: boolean;
  fieldKind: FieldKind;
}

export interface SelectEvent extends BaseEvent {
  kind: 'select';
  selector: string;
  fallbacks: string[];
  value: string;
}

export interface CheckEvent extends BaseEvent {
  kind: 'check' | 'uncheck';
  selector: string;
  fallbacks: string[];
}

export interface SubmitEvent extends BaseEvent {
  kind: 'submit';
  selector: string;
  fallbacks: string[];
}

export type RawEvent =
  | NavigateEvent
  | ClickEvent
  | TypeEvent
  | SelectEvent
  | CheckEvent
  | SubmitEvent;

/** Who produced a given automation version. */
export type VersionAuthor =
  | 'raw-recording'       // first conversion of recording to automation; pinned
  | 'user-edit'           // committed after a manual edit
  | 'ai-chat'             // committed after the user approves an AI chat proposal
  | 'ai-improve-legacy'   // committed by the legacy "Improve Steps" button
  | 'import';             // committed when a session zip is imported

/**
 * A committed version of the automation. The first entry in
 * `RecordingSession.versions` is always `raw-recording` and is pinned —
 * it is never pruned when the retention cap is hit.
 */
export interface AutomationVersion {
  id: string;             // uuid or unique string
  createdAt: number;      // epoch ms
  author: VersionAuthor;
  message: string;        // short human-readable description
  automation: Automation; // full snapshot (not a diff)
}

/** Serializable state of a recording session, stored in chrome.storage.local. */
export interface RecordingSession {
  id: string;
  status: 'recording' | 'paused' | 'stopped';
  startedAt: number;
  endedAt?: number;
  tabId?: number;
  events: RawEvent[];
  metadata: {
    name: string;
    goal: string;
    description: string;
  };
  /**
   * Simplified-HTML snapshots captured at each recorded event, keyed by
   * content hash (sha-256 hex). Identical consecutive snapshots on a
   * static page dedupe to a single entry.
   */
  snapshots?: Record<string, HtmlSnapshot>;
  /**
   * The automation as first derived from the raw recording events. Set
   * exactly once (when the user stops recording and the converter runs)
   * and never mutated after. The side panel's "Revert to original" button
   * restores this byte-for-byte.
   */
  original?: Automation;
  /**
   * Append-only history of committed automation versions. Index 0 is
   * always the raw recording and is pinned — retention pruning removes
   * the oldest non-pinned entry when the cap is exceeded.
   */
  versions?: AutomationVersion[];
  /** Points to the currently checked-out version in `versions`. */
  currentVersionId?: string;
}
