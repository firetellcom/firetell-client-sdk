export interface CallOptions {
  to: string;
  from?: string;
  caller?: string;
  number?: string;
  isVideo?: boolean;
  isTransfer?: boolean;
  isInternal?: boolean;
}
