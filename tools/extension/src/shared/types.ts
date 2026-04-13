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

interface BaseEvent {
  ts: number;
  url: string;
  title: string;
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
}
