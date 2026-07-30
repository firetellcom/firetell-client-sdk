# WebSocket Signaling — JSONRPC 2.0 API

## Connection

```
ws://<host>:<WS_PORT>
```

Protocol: **JSONRPC 2.0** via [rpc-websockets](https://github.com/elpheria/rpc-websockets)

### Request format

```json
{
  "jsonrpc": "2.0",
  "method": "<method_name>",
  "params": { ... },
  "id": 1
}
```

### Response format

```json
{
  "jsonrpc": "2.0",
  "result": { "message": "OK", "data": { ... } },
  "id": 1
}
```

### Notification format (Server → Client)

```json
{
  "notification": "<event_name>",
  "params": { ... }
}
```

---

## Authentication

### `session.connect`

Authenticate the WebSocket session with a JWT token. Must be called within **5 seconds** of connecting, otherwise the connection is terminated.

**Request:**

```json
{
  "method": "session.connect",
  "params": {
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Response:**

```json
{
  "message": "Connected",
  "data": {
    "session_id": "abc123",
    "display_name": "John Doe",
    "avatar": "https://...",
    "domain": "example.com",
    "username": "john",
    "expires_at": 1711900800000
  }
}
```

---

## Call Methods

### `call.offer`

Initiate an outbound call. SDP must contain all ICE candidates (Full ICE, not Trickle).

**Request:**

```json
{
  "method": "call.offer",
  "params": {
    "to": "0901234567",
    "sdp": "v=0\r\no=- ...",
    "number": "+84901234567"
  }
}
```

| Param    | Type   | Required | Description                                               |
| -------- | ------ | -------- | --------------------------------------------------------- |
| `to`     | string | ✅       | Destination number or username                            |
| `sdp`    | string | ✅       | Full SDP with ICE candidates                              |
| `number` | string | ❌       | Caller ID / outbound number (required for external calls) |

**Response:**

```json
{
  "message": "OK",
  "data": { "call_id": "1711855200000" }
}
```

> **Note:** Internal calls (username or extension ≤ 4 digits) don't require `number`.

---

### `call.answer`

Answer an incoming call.

**Request:**

```json
{
  "method": "call.answer",
  "params": {
    "call_id": "1711855200000",
    "sdp": {
      "type": "answer",
      "sdp": "v=0\r\no=- ..."
    },
    "is_internal": false,
    "is_transfer": false
  }
}
```

| Param         | Type                  | Required | Description                                  |
| ------------- | --------------------- | -------- | -------------------------------------------- |
| `call_id`     | string                | ✅       | Call ID from `call.offer` notification       |
| `sdp`         | RTCSessionDescription | ✅       | Answer SDP                                   |
| `is_internal` | boolean               | ❌       | Whether this is an internal call             |
| `is_transfer` | boolean               | ❌       | Whether this is answering a transferred call |

**Response:**

```json
{
  "message": "OK",
  "data": { "call_id": "1711855200000" }
}
```

---

### `call.hangup`

End an active call.

**Request:**

```json
{
  "method": "call.hangup",
  "params": {
    "call_id": "1711855200000"
  }
}
```

**Response:**

```json
{
  "message": "OK",
  "data": { "call_id": "1711855200000" }
}
```

---

### `call.reject`

Reject an incoming call. Other devices of the same user are notified.

**Request:**

```json
{
  "method": "call.reject",
  "params": {
    "call_id": "1711855200000"
  }
}
```

**Response:**

```json
{
  "message": "OK",
  "data": { "call_id": "1711855200000" }
}
```

---

### `call.hold`

Put a call on hold (sends re-INVITE with hold SDP).

**Request:**

```json
{
  "method": "call.hold",
  "params": {
    "call_id": "1711855200000",
    "sdp": {
      "type": "offer",
      "sdp": "v=0\r\n..."
    }
  }
}
```

**Response:**

```json
{
  "message": "OK",
  "data": {
    "type": "answer",
    "sdp": "v=0\r\n..."
  }
}
```

---

### `call.unhold`

Resume a held call (sends re-INVITE with active SDP).

**Request:** Same format as `call.hold`.

**Response:** Same format as `call.hold`.

---

### `call.transfer`

Transfer the call to another agent.

**Request:**

```json
{
  "method": "call.transfer",
  "params": {
    "call_id": "1711855200000",
    "callee": "agent_b"
  }
}
```

| Param     | Type   | Required | Description                  |
| --------- | ------ | -------- | ---------------------------- |
| `call_id` | string | ✅       | Active call ID               |
| `callee`  | string | ✅       | Username of the target agent |

**Response:**

```json
{
  "message": "OK",
  "data": { "call_id": "1711855200000" }
}
```

---

### `call.dtmf`

Send a DTMF tone via SIP INFO to Firetell's server.

**Request:**

```json
{
  "method": "call.dtmf",
  "params": {
    "call_id": "1711855200000",
    "digit": "5",
    "duration": 250
  }
}
```

| Param      | Type   | Required | Description                          |
| ---------- | ------ | -------- | ------------------------------------ |
| `call_id`  | string | ✅       | Active call ID                       |
| `digit`    | string | ✅       | Single digit: `0-9`, `*`, `#`, `A-D` |
| `duration` | number | ❌       | Duration in ms (default: 250)        |

**Response:**

```json
{
  "message": "OK",
  "data": { "call_id": "1711855200000", "digit": "5" }
}
```

---

### `call.mute`

Notify the server that the client has muted/unmuted their microphone. **The server broadcasts this state to other participants.** Actual audio muting is handled client-side by stopping the audio track.

**Request:**

```json
{
  "method": "call.mute",
  "params": {
    "call_id": "1711855200000",
    "muted": true
  }
}
```

**Response:**

```json
{
  "message": "OK",
  "data": { "call_id": "1711855200000", "muted": true }
}
```

---

### `call.reconnect`

Retrieve active calls after a WebSocket reconnection. The server automatically swaps the old socketId with the new one during the `connect` call (within the 15s grace period), so this method simply returns the current state.

**Request:**

```json
{
  "method": "call.reconnect",
  "params": {}
}
```

**Response:**

```json
{
  "message": "OK",
  "data": {
    "active_calls": [
      {
        "call_id": "1711855200000",
        "sdp": {
          "type": "answer",
          "sdp": "v=0\r\n..."
        },
        "media_type": "media"
      }
    ]
  }
}
```

> **Note:** If `active_calls` is empty, the user has no active calls.

---

### `call.getOffer`

Get the remote SDP for a call.

**Request:**

```json
{
  "method": "call.getOffer",
  "params": {
    "call_id": "1711855200000"
  }
}
```

**Response:**

```json
{
  "message": "OK",
  "data": {
    "sdp": "v=0\r\n...",
    "fromUri": "sip:user@domain"
  }
}
```

---

### `call.candidate`

> ⚠️ **Not functional.** Firetell does not support Trickle ICE. Clients must gather all ICE candidates before sending `call.offer`.

---

## Heartbeat

### `session.pong` (Client → Server)

Response to the server's `session.ping` event.

**Request:**

```json
{
  "method": "session.pong",
  "params": {
    "timestamp": 1711855200000
  }
}
```

**Response:**

```json
{
  "message": "You're still alive",
  "timestamp": 1711855200000,
  "sessions": 1
}
```

---

## Server Notifications

Events pushed from the server to connected clients.

### `call.ended`

Call ended notification.

```json
{
  "notification": "call.ended",
  "params": {
    "call_id": "1711855200000",
    "reason": "NORMAL_CLEARING",
    "status": 16
  }
}
```

### `call.answered`

Call answered notification.

```json
{
  "notification": "call.answered",
  "params": {
    "call_id": "1711855200000",
    "sdp": {
      "type": "answer",
      "sdp": "v=0\r\n..."
    }
  }
}
```

**Possible states:**

| State      | Status | Description                                              |
| ---------- | ------ | -------------------------------------------------------- |
| `TRYING`   | 100    | INVITE sent                                              |
| `RINGING`  | 180    | Remote is ringing                                        |
| `ANSWERED` | 200    | Call connected                                           |
| `ENDED`    | varies | Call terminated (BYE, timeout, error)                    |
| `CANCEL`   | varies | Call cancelled (by caller or answered on another device) |
| `ERROR`    | varies | Call error                                               |

---

### `call.offer`

Incoming call notification.

```json
{
  "notification": "call.offer",
  "params": {
    "call_id": "1711855200000",
    "caller": "0901234567",
    "number": "+84901234567",
    "sdp": {
      "type": "offer",
      "sdp": "v=0\r\n..."
    },
    "is_transfer": false
  }
}
```

---

### `call.mute`

Mute state changed by another participant.

```json
{
  "notification": "call.mute",
  "params": {
    "call_id": "1711855200000",
    "username": "admin",
    "muted": true
  }
}
```

---

### `workspace.agent.state`

Agent online/offline status change.

```json
{
  "notification": "workspace.agent.state",
  "params": {
    "username": "admin",
    "state": "available"
  }
}
```

**Possible states:** `available`, `offline`

---

### `session.ping`

Heartbeat sent every 60 seconds.

```json
{
  "notification": "session.ping",
  "params": {
    "timestamp": 1711855200000
  }
}
```

---

## Reconnection Flow

When a WebSocket connection drops during an active call:

```
1. Client detects WS disconnect
2. Server starts 15s grace period (SIP call continues)
3. Client reconnects WS
4. Client calls connect({ token }) → authenticated
5. Server auto-swaps old socketId → new socketId in active calls
6. Client calls call.reconnect({}) → gets active calls list
7. Client restores call UI
```

> If the client does NOT reconnect within 15 seconds, the server performs full cleanup (removes client, emits offline status). The SIP dialog remains active until Firetell's server terminates it.
