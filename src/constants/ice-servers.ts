/**
 * Fallback ICE (STUN) servers used when workspace metadata is unavailable
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
    ],
  },
  {
    urls: ["stun:stun.cloudflare.com:3478"],
  },
];
