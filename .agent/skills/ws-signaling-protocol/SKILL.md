---
name: ws-signaling-protocol
description: >
  WebSocket signaling protocol reference for firetell-client-sdk.
  Trigger on: any work involving JSON-RPC methods, WebSocket messages,
  notification handling, call.offer, call.answer, call.state, session.connect,
  heartbeat (ping/pong), or reconnection flow.
---

# WebSocket Signaling Protocol

## Protocol Overview

- Transport: WebSocket
- Message format: JSON-RPC 2.0
- Server library: rpc-websockets

## Message Formats

### Client → Server (Request)
```json
{
  "jsonrpc": "2.0",
  "method": "<method_name>",
  "params": { ... },
  "id": 1
}
```

### Server → Client (Response)
```json
{
  "jsonrpc": "2.0",
  "result": { "message": "OK", "data": { ... } },
  "id": 1
}
```

### Server → Client (Notification — no `jsonrpc` field)
```json
{
  "notification": "<event_name>",
  "params": { ... }
}
```

## Authentication

### `session.connect` — MUST be called within 5 seconds of WS open
- Request: `{ token: "jwt..." }`
- Response data: `{ session_id, display_name, avatar?, domain, username, expires_at }`

## Call Methods

| Method | Request Params | Response Data | Notes |
|--------|---------------|---------------|-------|
| `call.offer` | `{ to, sdp, number? }` | `{ call_id }` | SDP must be Full ICE |
| `call.answer` | `{ call_id, sdp, is_internal?, is_transfer? }` | `{ call_id }` | |
| `call.hangup` | `{ call_id }` | `{ call_id }` | |
| `call.reject` | `{ call_id }` | `{ call_id }` | Notifies other devices |
| `call.hold` | `{ call_id, sdp }` | answer SDP | Re-INVITE based |
| `call.unhold` | `{ call_id, sdp }` | answer SDP | Same as hold |
| `call.transfer` | `{ call_id, callee }` | `{ call_id }` | Blind transfer |
| `call.dtmf` | `{ call_id, digit, duration? }` | `{ call_id, digit }` | Via SIP INFO |
| `call.mute` | `{ call_id, muted }` | `{ call_id, muted }` | Server broadcasts |
| `call.reconnect` | `{}` | `{ active_calls: [...] }` | After WS reconnect |
| `call.getOffer` | `{ call_id }` | `{ sdp, fromUri }` | Get remote SDP |

## Server Notifications

| Notification | Params | Trigger |
|-------------|--------|---------|
| `call.state` | `{ call_id, state, reason?, status?, sdp? }` | Call lifecycle change |
| `call.offer` | `{ call_id, caller, number, sdp, is_transfer? }` | Incoming call |
| `call.mute` | `{ call_id, username, muted }` | Remote participant mute |
| `workspace.agent.state` | `{ username, state }` | Agent online/offline |
| `session.ping` | `{ timestamp }` | Heartbeat (every 60s) |

### Call States
`TRYING` (100) → `RINGING` (180) → `ANSWERED` (200) → `ENDED` / `CANCEL` / `ERROR`

## Heartbeat
- Server sends `session.ping` every 60 seconds
- Client responds with `session.pong` (fire-and-forget, no callback)
- SDK watchdog: 90s timeout, 3 consecutive misses → force reconnect

## Reconnection Flow
```
1. Client detects WS disconnect
2. Server starts 15s grace period (SIP call continues)
3. Client reconnects with exponential backoff
4. Client calls session.connect → re-authenticated
5. Server auto-swaps old socketId → new socketId
6. Client calls call.reconnect → gets active calls
7. SDK emits 'reconnected' event
```

> ⚠️ If client does NOT reconnect within 15s, server performs full cleanup.

## Important Constraints

- **Full ICE only** — FreeSwitch does not support Trickle ICE
- **Single active call** — SDK enforces one call at a time
- **5s auth window** — Must call `session.connect` within 5 seconds of WS open
- **`call.candidate`** — Exists but non-functional (Trickle ICE not supported)

## Full protocol reference
See [ws-signaling.md](file:///Users/sangnguyen/Apps_dev/firetell/firetell-client-sdk/ws-signaling.md) for the complete specification.
