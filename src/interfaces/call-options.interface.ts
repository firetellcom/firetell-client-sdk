export interface CallOptions {
  to?: string;
  from?: string;
  from_name?: string;
  from_avatar?: string | null;
  isVideo?: boolean;
  isTransfer?: boolean;
  transferReason?: string;
  isInternal?: boolean;
}
