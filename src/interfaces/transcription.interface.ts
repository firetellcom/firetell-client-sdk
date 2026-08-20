export interface ITranscriptionStartedEvent {
  call_id: string;
  direction?: string;
  language?: string;
  channels?: number;
  provider?: string;
  model?: string;
  timestamp?: string;
}

export interface ITranscriptionEntity {
  type: string;
  value: string;
}

export interface ITranscriptionDialogueEvent {
  id?: string;
  call_id: string;
  speaker?: string;
  channel_index?: number;
  direction?: string;
  text: string;
  is_final?: boolean;
  speech_final?: boolean;
  confidence?: number;
  duration_ms?: number;
  entities?: ITranscriptionEntity[];
  timestamp?: string;
}

export interface ITranscriptionCompletedEvent {
  id?: string;
  call_id: string;
  workspace_id?: string;
  direction?: string;
  language?: string;
  provider?: string;
  model?: string;
  dialogue_count?: number;
  dialogues?: ITranscriptionDialogueEvent[];
  full_text?: string;
  summary?: string | null;
  sentiment?: string | null;
  action_items?: string[];
  entities?: ITranscriptionEntity[];
  duration_seconds?: number;
  timestamp?: string;
}

export type TranscriptionEvent =
  | { type: 'started'; data: ITranscriptionStartedEvent }
  | { type: 'dialogue'; data: ITranscriptionDialogueEvent }
  | { type: 'completed'; data: ITranscriptionCompletedEvent };
