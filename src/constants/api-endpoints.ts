/**
 * API endpoint paths used by the SDK.
 * All paths are relative to the workspace base URL.
 */
export const API_ENDPOINTS = {
  /** Workspace metadata (WS servers, ICE servers) */
  WORKSPACE_METADATA: "/api/v1",
  /** Agent login (username/password → JWT) */
  AUTH_LOGIN: "/api/v1/auth/login",
  /** REST Make Call Endpoint */
  MAKE_CALL: "/api/v1/call-center/calls",
  /** SSE Realtime Events Stream Endpoint */
  EVENT_STREAM: "/stream",
  /** Supervision Endpoints */
  SUPERVISION: (callId: string, mode: string) => `/api/v1/call-center/calls/${callId}/${mode}`,
  /** Stop Supervision Endpoint */
  SUPERVISION_STOP: (callId: string) => `/api/v1/call-center/calls/${callId}/supervision`,
  /** Call Transfer Endpoint */
  TRANSFER: (callId: string) => `/api/v1/call-center/calls/${callId}/transfer`,
} as const;
