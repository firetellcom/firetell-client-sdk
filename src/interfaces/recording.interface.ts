export interface ICallRecordingStartedEvent {
  call_id: string;
  workspace_id?: string;
  record_id?: string;
  timestamp?: string | number;
  [key: string]: unknown;
}

export interface ICallRecordingCompletedEvent {
  call_id: string;
  workspace_id?: string;
  record_id?: string;
  duration?: number;
  format?: string;
  timestamp?: string | number;
  [key: string]: unknown;
}

export interface ICallRecordingReadyEvent {
  call_id: string;
  workspace_id?: string;
  record_id?: string;
  url?: string;
  duration?: number;
  format?: string;
  size_bytes?: number;
  timestamp?: string | number;
  [key: string]: unknown;
}

export type CallRecordingEvent =
  | { type: "started"; data: ICallRecordingStartedEvent }
  | { type: "completed"; data: ICallRecordingCompletedEvent };
