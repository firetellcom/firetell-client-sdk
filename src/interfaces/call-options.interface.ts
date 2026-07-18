export interface CallOptions {
  number?: string;
  calleeId: string;
  caller?: string;
  isVideo?: boolean;
  isTransfer?: boolean;
  isInternal?: boolean;
}
