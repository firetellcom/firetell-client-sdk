/**
 * API endpoint paths used by the SDK.
 * All paths are relative to the workspace base URL.
 */
export const API_ENDPOINTS = {
  /** Workspace metadata (WS servers, ICE servers) */
  WORKSPACE_METADATA: "/api/v1",
  /** Agent login (username/password → JWT) */
  AUTH_LOGIN: "/api/v1/auth/login",
} as const;
