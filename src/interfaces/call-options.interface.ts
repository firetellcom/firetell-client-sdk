export interface CallOptions {
  to?: string;
  from?: string;
  from_name?: string;
  isVideo?: boolean;
  isTransfer?: boolean;
  transferReason?: string;
  isInternal?: boolean;
}
