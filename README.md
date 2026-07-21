# Firetell Client SDK

TypeScript/JavaScript SDK for Firetell WebRTC — make and receive audio/video calls via REST API initiation, Native WebSockets per call, and Server-Sent Events (SSE).

## Features

- 📞 **Audio/Video Calls** — Outbound and inbound WebRTC calls via REST API & Native WebSocket per call
- 🌐 **Native WebSocket & SSE** — Lightweight, zero external dependencies (`socket.io`/`rpc-websockets` free)
- 🔒 **Unified Call Token** — Short-lived `call_token` JWT authentication per call session
- 🎧 **Call Supervision** — Support for `listen`, `whisper`, and `barge` supervision modes
- 📥 **Incoming Call Handling** — Accept, reject, or auto-handle incoming calls
- ⏸️ **Hold / Unhold** — Re-INVITE based hold with SDP renegotiation
- 🔇 **Mute / Unmute** — Client-side audio track control + server notification
- 🎹 **DTMF** — Send DTMF tones via SIP INFO
- 👥 **Agent Presence** — Real-time agent status changes via SSE stream (`GET /call-center/events/stream`)
- 📦 **TypeScript** — Full type definitions with typed event emitter

## Installation

```bash
npm install @firetell/firetell-client-sdk
```

Or use via CDN (IIFE bundle):

```html
<script src="dist/index.global.js"></script>
<script>
  const token = "your-agent-jwt-token";
  const domain = "your-workspace-domain";
  const client = new Firetell.FiretellClient(token, domain);
</script>
```

## Quick Start

### 1. Initialize Client

```typescript
import {
  FiretellClient,
  Call,
  ECallState,
  EClientEventName,
} from "@firetell/firetell-client-sdk";

const client = new FiretellClient("your-jwt-token", "https://your-workspace.firetell.app");

// Wait for the client to be fully initialized
const session = await client.ready;
console.log("Connected as:", session.username);
```

### 2. Listen to Realtime Events (SSE & WebSockets)

```typescript
// Incoming call offer (call.offer)
client.events.on("call.offer", (call) => {
  console.log("Incoming caller number (from):", call.from);        // "+84901234567"
  console.log("Incoming caller display name (from_name):", call.from_name); // "Nguyen Van A (VIP)"
  console.log("Called hotline / target number (to):", call.to);    // "+842471000000"
});

// Teammate presence state updates
client.events.on("workspace.agent.state", ({ username, state }) => {
  console.log(`${username} is now ${state}`); // "available" | "offline"
});

// Errors
client.events.on("error", (error) => {
  console.error(`Error [${error.code}]:`, error.message);
});
```

### 3. Make an Outbound Call

```typescript
const call = new Call(client, {
  to: "+84901234567",     // Recipient phone number or extension
  from: "+84281234567",   // Outbound caller ID phone number (optional)
  isVideo: false,
});

// Listen to call events
call.on("state", (params) => {
  console.log("Call State:", params.state); // INITIATED → ANSWERED → ENDED
});

// Start call (HTTP REST POST /calls → returns call_token → opens per-call WebSocket)
await call.start();
```

### 4. Call Supervision (Supervisor Only)

```typescript
// Listen (silent monitor), whisper (coach agent), or barge (3-way call)
const supervision = await client.superviseCall("cl_123456", "listen");
console.log("Supervision active with call_token:", supervision.call_token);
```
