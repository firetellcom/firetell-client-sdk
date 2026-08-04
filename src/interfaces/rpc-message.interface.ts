export interface IWSMessage {
  event: string;
  data?: unknown;
  seq?: number;
}

export interface IWSErrorPayload {
  code: number;
  message: string;
}