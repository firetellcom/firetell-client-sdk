export interface IActiveCall {
  call_id: string;
  sdp: RTCSessionDescriptionInit;
  media_type: string;
}
