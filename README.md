# Firetell Client SDK

TypeScript/JavaScript SDK for Firetell WebRTC — make and receive audio/video calls via WebRTC signaling over WebSocket (JSON-RPC 2.0).

## Features

- 📞 **Audio/Video Calls** — Outbound and inbound WebRTC calls with full ICE gathering
- 🔐 **Session Management** — JWT-based authentication via `session.connect`
- 📥 **Incoming Call Handling** — Accept, reject, or auto-handle incoming calls
- ⏸️ **Hold / Unhold** — Re-INVITE based hold with SDP renegotiation
- 🔀 **Call Transfer** — Blind transfer to another agent
- 🔇 **Mute / Unmute** — Client-side audio track control + server notification
- 🎹 **DTMF** — Send DTMF tones via SIP INFO
- 🔄 **Auto-Reconnect** — Exponential backoff reconnection with active call recovery
- 💓 **Heartbeat** — Automatic `session.ping/pong` with stale connection detection
- 👥 **Agent Presence** — Real-time agent online/offline status
- 📦 **TypeScript** — Full type definitions with typed event emitter

## Installation

```bash
npm install @firetell/firetell-client-sdk
```

Or use via CDN (IIFE bundle):

```html
<script src="dist/index.global.js"></script>
<script>
  const client = new Firetell.FiretellClient(token);
</script>
```

## Quick Start

### 1. Initialize Client

```typescript
import { FiretellClient, Call, ECallState, EClientEventName } from '@firetell/firetell-client-sdk';

const client = new FiretellClient(
  'your-jwt-token',
  'https://api.firetell.com/1.0' // optional
);

// Wait for the client to be fully initialized
const session = await client.ready;
console.log('Connected as:', session.username);
```

### 2. Listen to Events

```typescript
// Session established
client.events.on('session', (session) => {
  console.log('Authenticated:', session.display_name);
});

// Errors
client.events.on('error', (error) => {
  console.error(`Error [${error.code}]:`, error.message);
});

// Incoming call
client.events.on('call.offer', (call) => {
  console.log('Incoming call from:', call.caller);
});

// Agent presence
client.events.on('workspace.agent.state', ({ username, state }) => {
  console.log(`${username} is now ${state}`); // "available" | "offline"
});

// Active calls restored after reconnection
client.events.on('reconnected', (activeCalls) => {
  console.log('Restored calls:', activeCalls);
});
```

### 3. Make a Call

```typescript
const call = new Call(client, {
  calleeId: '1001',            // Destination (username or number)
  number: '+84978126124',      // Caller ID (required for external calls)
  isVideo: false,
});

// Listen to call events
call.on('state', (params) => {
  console.log('State:', params.state); // TRYING → RINGING → ANSWERED → ACTIVE
  if (['ENDED', 'ERROR', 'CANCEL'].includes(params.state)) {
    console.log('Call ended:', params.reason);
  }
});

call.on('localStream', (stream) => {
  document.getElementById('localAudio').srcObject = stream;
});

call.on('remoteStream', (stream) => {
  document.getElementById('remoteAudio').srcObject = stream;
});

call.on('mediaState', (state) => {
  console.log('ICE state:', state); // "connected", "disconnected", etc.
});

// Start the call (gathers ICE → sends call.offer)
await call.start();
```

### 4. Handle Incoming Calls

```typescript
client.events.on('call.offer', async (call) => {
  console.log('Incoming from:', call.caller, call.isTransfer ? '(transfer)' : '');

  call.on('state', (params) => console.log('State:', params.state));
  call.on('localStream', (s) => { /* attach to audio element */ });
  call.on('remoteStream', (s) => { /* attach to audio element */ });

  // Accept
  await call.accept();

  // Or reject
  // await call.reject();
});
```

### 5. Call Control

```typescript
// Hold / Unhold
await call.onhold();
await call.unhold();
console.log('On hold?', call.isHold);

// Mute / Unmute
await call.mute();
await call.unmute();
await call.toggleMute();
console.log('Muted?', call.isMuted);

// Send DTMF
await call.sendDTMF('5');
await call.sendDTMF('#', 500); // custom duration (ms)

// Transfer to another agent
await call.transfer('agent_b');

// Hang up
await call.hangup();
```

## API Reference

### FiretellClient

#### Constructor

```typescript
new FiretellClient(jwt: string, baseUrl?: string)
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `jwt` | `string` | — | JWT token for authentication |
| `baseUrl` | `string` | `https://api.firetell.com/1.0` | API base URL |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `ready` | `Promise<ISession>` | Resolves when client is fully initialized |
| `connected` | `boolean` | WebSocket connection status |
| `activeCalls` | `Map<string, Call>` | Current active calls |
| `isWebRTCSupport` | `boolean` | Whether WebRTC is supported |
| `sdkVersion` | `string` | SDK version |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<ISession>` | Authenticate via `session.connect` |
| `makeCall(call, sdp)` | `Promise<string>` | Send `call.offer` |
| `sendAccept(callId, sdp)` | `Promise<void>` | Send `call.answer` |
| `sendReject(callId)` | `Promise<void>` | Send `call.reject` |
| `sendHangup(callId)` | `Promise<void>` | Send `call.hangup` |
| `sendHold(callId, sdp)` | `Promise<RTCSessionDescription>` | Send `call.hold` |
| `sendUnHold(callId, sdp)` | `Promise<RTCSessionDescription>` | Send `call.unhold` |
| `sendTransfer(callId, callee)` | `Promise<void>` | Send `call.transfer` |
| `sendDTMF(callId, digit, duration?)` | `Promise<void>` | Send `call.dtmf` |
| `sendMute(callId, muted)` | `Promise<void>` | Send `call.mute` |
| `getSessionInfo()` | `ISession \| null` | Current session info |
| `logout()` | `void` | Cleanup and disconnect |

#### Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `session` | `ISession \| null` | Session connected / disconnected |
| `error` | `{ code, message }` | Error occurred |
| `call.offer` | `Call` | Incoming call |
| `call.mute` | `{ call_id, username, muted }` | Remote participant mute state |
| `workspace.agent.state` | `{ username, state }` | Agent online/offline |
| `reconnected` | `IActiveCall[]` | Active calls restored after reconnection |

---

### Call

#### Constructor

```typescript
new Call(client: FiretellClient, options: CallOptions)
```

#### CallOptions

```typescript
interface CallOptions {
  calleeId: string;       // Destination number or username (required)
  number?: string;        // Caller ID / outbound number
  caller?: string;        // Caller display name
  isVideo?: boolean;      // Video call (default: false)
  isTransfer?: boolean;   // Answering a transferred call
  isInternal?: boolean;   // Internal call flag
}
```

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Start outbound call |
| `accept()` | `Promise<void>` | Accept incoming call |
| `reject()` | `Promise<void>` | Reject incoming call |
| `hangup()` | `Promise<void>` | End call |
| `onhold()` | `Promise<void>` | Put on hold |
| `unhold()` | `Promise<void>` | Resume from hold |
| `mute()` | `Promise<void>` | Mute microphone |
| `unmute()` | `Promise<void>` | Unmute microphone |
| `toggleMute()` | `Promise<void>` | Toggle mute state |
| `sendDTMF(digit, duration?)` | `Promise<void>` | Send DTMF tone |
| `transfer(callee)` | `Promise<void>` | Transfer call |
| `destroy()` | `Promise<void>` | Cleanup resources |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `callId` | `string` | Call identifier |
| `callState` | `ECallState` | Current call state |
| `active` | `boolean` | Whether call is active |
| `isMuted` | `boolean` | Mute state |
| `isHold` | `boolean` | Hold state |
| `isTransfer` | `boolean` | Transfer call flag |
| `caller` | `string` | Caller identifier |
| `calleeId` | `string` | Callee identifier |

#### Call Events

| Event | Payload | Description |
|-------|---------|-------------|
| `state` | `{ call_id, state, reason?, status? }` | Call state change |
| `localStream` | `MediaStream \| null` | Local media stream |
| `remoteStream` | `MediaStream \| null` | Remote media stream |
| `mediaState` | `RTCIceConnectionState` | ICE connection state |
| `mute` | `{ muted: boolean }` | Local mute state changed |

---

### Enums

```typescript
enum ECallState {
  INITIATED, TRYING, RINGING, ANSWERED,
  ACTIVE, ONHOLD, ENDED, ERROR, CANCEL
}

enum EClientEventName {
  SESSION, ERROR, CALL_OFFER,
  CALL_MUTE, AGENT_STATE, RECONNECTED
}

enum ECallEventName {
  mediaState, state, localStream, remoteStream, mute
}
```

---

### Interfaces

```typescript
interface ISession {
  session_id: string;
  display_name: string;
  username: string;
  domain: string;
  avatar?: string;
  ext?: string;
  expires_at: number;
}
```

## Reconnection Flow

When the WebSocket drops during an active call, the SDK handles recovery automatically:

```
1. Client detects WS disconnect
2. Server starts 15s grace period (SIP call continues)
3. Client reconnects with exponential backoff (max 30 retries)
4. Client calls session.connect → re-authenticated
5. Server auto-swaps old socketId → new socketId
6. Client calls call.reconnect → gets active calls list
7. SDK emits 'reconnected' event with active calls
```

If no ping is received for 3 consecutive intervals (90s each), the SDK considers the connection stale and forces a reconnect.

## Example

See [`example/index.html`](example/index.html) for a complete browser example with UI.

## System Requirements

- WebRTC-supported browser (Chrome, Firefox, Safari, Edge)
- HTTPS or localhost (required for `getUserMedia`)
- Stable internet connection

## Notes

- SDK supports one active call at a time
- Valid JWT token is required — must contain `username` and `domain`
- Camera/microphone permissions must be granted
- SDP must include all ICE candidates (Full ICE, not Trickle) — FreeSwitch requirement

## Build

```bash
npm run build    # Outputs CJS, ESM, IIFE + type definitions to dist/
```

## License

ISC

## Support

Contact: developers@firetell.com