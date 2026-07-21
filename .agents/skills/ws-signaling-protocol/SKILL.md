---
name: ws-signaling-protocol
description: >
  Native WebSocket per-call signaling protocol reference for firetell-client-sdk.
  Trigger on: any work involving Event-based WS messages, call.offer, call.answer,
  call_token authentication, session.connect (3s timeout), or SSE stream events.
---

# Scoped Native WebSocket Signaling Protocol

## Protocol Overview

- **Transport**: Native WebSocket (`ws` / `wss`) per call session
- **Message format**: Native Event-Based JSON (`{ "event": string, "data": object }`)
- **No Dependencies**: No `rpc-websockets` or `socket.io`

## Message Format

```json
{
  "event": "<event_name>",
  "data": { ... }
}
```

## Authentication

### `session.connect` — MUST be sent within 3 seconds of WebSocket open
- Event: `session.connect`
- Data: `{ token: "call_token_jwt..." }`
- Response Event from Server: `session.connected` `{ session_id, workspace_id, username, call_id, mode }`
- ⚠️ **Server Enforcement**: If `session.connect` with a valid `call_token` (JWT with `aud: 'call-session'`) is not received within 3 seconds, the server terminates the socket.

## Outbound Call & Supervision Flow

1. **Make Call REST API**: `POST /api/v1/call-center/calls` → Returns `{ call_id, call_token, ws_url }`.
2. **Open Scoped WS**: Connect to `ws_url`.
3. **Send Handshake**: Send `session.connect` with `call_token` within 3s.
4. **Send SDP Offer**: Send `call.offer` with `{ call_id, sdp }`.

## Call Events

| Event | Direction | Data | Notes |
|-------|-----------|------|-------|
| `session.connect` | Client → Server | `{ token }` | Must be sent within 3s |
| `session.connected` | Server → Client | `{ session_id, workspace_id, username, call_id }` | Handshake ACK |
| `call.offer` | Client → Server | `{ call_id, sdp }` | SDP Offer |
| `call.offered` | Server → Client | `{ call_id }` | Offer ACK |
| `call.answer` | Client → Server | `{ call_id, sdp }` | SDP Answer |
| `call.answered` | Server → Client | `{ call_id, sdp }` | Call answered ACK |
| `call.candidate` | Client → Server | `{ call_id, candidate }` | ICE Candidate |
| `call.hold` | Client → Server | `{ call_id, sdp }` | Hold call |
| `call.unhold` | Client → Server | `{ call_id, sdp }` | Unhold call |
| `call.hangup` | Client → Server | `{ call_id }` | Hangup call |
| `call.reject` | Client → Server | `{ call_id }` | Reject call |
| `call.mute` | Client → Server | `{ call_id, muted }` | Mute/unmute state |

## Background Events (SSE)

Real-time workspace events (presence changes, queue updates, incoming call ringing) are observed over **Server-Sent Events (SSE)** via `GET /api/v1/call-center/events/stream`.
