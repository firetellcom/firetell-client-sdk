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

/**
 * Refresh TURN credentials before a call when they expire within this window.
 * coturn re-validates credentials on every allocation Refresh, so the remaining
 * validity at call start must exceed the longest expected call.
 */
export const ICE_REFRESH_THRESHOLD_MS = 6 * 60 * 60 * 1000;

/** Max time to wait for the ICE refresh request before falling back to cached servers */
export const ICE_REFRESH_TIMEOUT_MS = 3000;
