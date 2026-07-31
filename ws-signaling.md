# Native WebSocket Signaling Protocol

## Connection

Per-call scoped WebSocket connection:
```
wss://<workspace-domain>/call-session
```

Protocol: **Native Event-Based WebSocket** (Zero external dependencies, no `rpc-websockets` or `socket.io`).

### Request & Response Message Format

All WebSocket messages follow a lightweight event JSON structure:

```json
{
  "event": "<event_name>",
  "data": { ... }
}
```

---

## Authentication

### `session.connect`

Authenticate the WebSocket session using a short-lived `call_token` JWT. **MUST be sent within 3 seconds** of WebSocket connection, otherwise the server terminates the socket.

**Client Send:**

```json
{
  "event": "session.connect",
  "data": {
    "token": "call_token_jwt..."
  }
}
```

**Server Response (`session.connected`):**

```json
{
  "event": "session.connected",
  "data": {
    "session_id": "sess_123456",
    "workspace_id": "ws_7890",
    "username": "agent_john",
    "call_id": "call_1711855200000",
    "mode": "agent"
  }
}
```

---

## Call Protocol Events

### `call.offer`

Send WebRTC SDP offer to initiate media negotiation. SDP must contain all gathered ICE candidates (Full ICE).

**Client Send:**

```json
{
  "event": "call.offer",
  "data": {
    "call_id": "call_1711855200000",
    "sdp": "v=0\r\no=- ..."
  }
}
```

**Server Response (`call.offered`):**

```json
{
  "event": "call.offered",
  "data": {
    "call_id": "call_1711855200000"
  }
}
```

---

### `call.answer`

Answer an incoming call offer with SDP answer.

**Client Send:**

```json
{
  "event": "call.answer",
  "data": {
    "call_id": "call_1711855200000",
    "sdp": "v=0\r\no=- ..."
  }
}
```

**Server Response (`call.answered`):**

```json
{
  "event": "call.answered",
  "data": {
    "call_id": "call_1711855200000",
    "sdp": "v=0\r\no=- ..."
  }
}
```

---

### `call.hangup`

End an active call session.

**Client Send:**

```json
{
  "event": "call.hangup",
  "data": {
    "call_id": "call_1711855200000"
  }
}
```

---

### `call.reject`

Reject an incoming call.

**Client Send:**

```json
{
  "event": "call.reject",
  "data": {
    "call_id": "call_1711855200000"
  }
}
```

---

### `call.hold`

Put an active call on hold via SDP renegotiation.

**Client Send:**

```json
{
  "event": "call.hold",
  "data": {
    "call_id": "call_1711855200000",
    "sdp": "v=0\r\no=- ..."
  }
}
```

---

### `call.unhold`

Resume a held call via SDP renegotiation.

**Client Send:**

```json
{
  "event": "call.unhold",
  "data": {
    "call_id": "call_1711855200000",
    "sdp": "v=0\r\no=- ..."
  }
}
```

---

### `call.dtmf`

Send a DTMF tone via SIP INFO to the server.

**Client Send:**

```json
{
  "event": "call.dtmf",
  "data": {
    "call_id": "call_1711855200000",
    "digit": "5",
    "duration": 250
  }
}
```

---

### `call.mute`

Notify server of client-side microphone mute state change.

**Client Send:**

```json
{
  "event": "call.mute",
  "data": {
    "call_id": "call_1711855200000",
    "muted": true
  }
}
```

---

### `call.candidate`

Send an ICE candidate to the server.

**Client Send:**

```json
{
  "event": "call.candidate",
  "data": {
    "call_id": "call_1711855200000",
    "candidate": {
      "candidate": "candidate:1 1 UDP...",
      "sdpMid": "0",
      "sdpMLineIndex": 0
    }
  }
}
```

---

## Server Events & Notifications

### `call.state`

Call lifecycle state transition pushed by the server.

```json
{
  "event": "call.state",
  "data": {
    "call_id": "call_1711855200000",
    "state": "ANSWERED",
    "sdp": "v=0\r\no=- ..."
  }
}
```

**Call states:** `INITIATED`, `TRYING`, `RINGING`, `ANSWERED`, `ENDED`, `CANCEL`, `ERROR`.

---

### `error`

Error event pushed by the server.

```json
{
  "event": "error",
  "data": {
    "code": 401,
    "message": "Invalid or expired call token"
  }
}
```

---

## Workspace Background Events (SSE Stream)

Workspace-wide real-time events (agent status, incoming call ring popups) are consumed over **Server-Sent Events (SSE)** at `GET /api/v1/call-center/events/stream`:

- `call.ring`: Incoming call notification payload `{ call_id, from, to }`
- `agent.state`: Teammate status payload `{ username, state }`
