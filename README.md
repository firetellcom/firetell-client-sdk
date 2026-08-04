# @firetell/firetell-client-sdk

[![npm version](https://img.shields.io/npm/v/@firetell/firetell-client-sdk.svg)](https://www.npmjs.com/package/@firetell/firetell-client-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official TypeScript/JavaScript SDK for building WebRTC Voice & Video Communications applications on the Firetell Platform (CPaaS, Virtual PBX, Call Center, Voice AI, SIP Trunking).

🎮 **Live Interactive Demo**: [https://developers.firetell.com/firetell-client-sdk/example/](https://developers.firetell.com/firetell-client-sdk/example/)

---

## 🌟 Key Features

- 📞 **WebRTC Outbound & Inbound Calls** — High-quality audio/video calls using Native WebSockets per call session.
- 🎵 **Early Media & PSTN Ringback Audio (`call.sdp` / 183 Session Progress)** — Full support for early audio playback so callers hear PSTN ringback tones or early IVR prompts before the callee answers.
- 🌐 **Native WebSockets & SSE** — Lightweight, zero external dependencies (no Socket.IO or heavy WS wrappers).
- 🔒 **Per-Call Security Tokens** — Short-lived `call_token` JWT authentication per WebRTC session.
- 🎧 **Call Center Supervision** — Built-in `listen` (silent monitor), `whisper` (coach agent), and `barge` (3-way call) supervision modes.
- 📥 **Instant Incoming Call Alerts** — Real-time ring notifications via SSE (`call.ring`) and WebRTC offer payloads (`call.offer`).
- ⏸️ **In-Call Control** — Re-INVITE based Hold/Unhold, client-side Mute/Unmute, and DTMF tones (SIP INFO).
- 👥 **Real-time Agent Presence** — Track team availability via Server-Sent Events (`agent.state`).
- 📦 **Multi-Format Distribution** — Distributed as ESM (`.mjs`), CommonJS (`.js`), and Browser Bundle (`.global.js`).

---

## 📦 Installation

```bash
npm install @firetell/firetell-client-sdk
# or
yarn add @firetell/firetell-client-sdk
# or
pnpm add @firetell/firetell-client-sdk
```

### Browser CDN Usage

```html
<script src="https://cdn.jsdelivr.net/npm/@firetell/firetell-client-sdk/dist/index.global.js"></script>
<script>
  const token = "YOUR_AGENT_JWT_TOKEN";
  const domain = "your-workspace.firetell.app";
  const client = new Firetell.FiretellClient(token, domain);
</script>
```

---

## 🚀 Quick Start Guide

### 1. Initialize the Client

```typescript
import {
  FiretellClient,
  Call,
  ECallState,
  EClientEventName,
  ECallEventName,
} from "@firetell/firetell-client-sdk";

// Initialize client with agent JWT and workspace domain/URL
const client = new FiretellClient(
  "YOUR_AGENT_JWT_TOKEN",
  "https://your-workspace.firetell.app"
);

// Wait for connection initialization
const session = await client.ready;
console.log(`Connected as Agent: ${session.username} (${session.workspace_id})`);
```

---

### 2. Make an Outbound Call (with Early Media Support)

```typescript
// HTML audio elements for WebRTC streams
const remoteAudio = document.getElementById("remote-audio") as HTMLAudioElement;

// Create Call instance
const call = new Call(client, {
  to: "+84901234567",     // Extension, agent username, or phone number
  from: "+842871000000",   // Optional outbound Caller ID
  isVideo: false,
});

// 1. Listen for remote audio stream (Works for Early Media & Answered states!)
call.on(ECallEventName.REMOTE_STREAM, (remoteStream) => {
  console.log("Received Remote Stream (Early Media / Audio Answer):", remoteStream);
  remoteAudio.srcObject = remoteStream;
  remoteAudio.play().catch(console.error);
});

// 2. Listen to call state changes
call.on(ECallEventName.STATE, (payload) => {
  console.log("Call State Changed:", payload.state, payload.reason);
  // States: INITIATED -> TRYING -> RINGING -> ACTIVE (ANSWERED) -> ENDED
  switch (payload.state) {
    case ECallState.RINGING:
      console.log("Ringing / Early Media established...");
      break;
    case ECallState.ACTIVE:
      console.log("Call Connected & Active!");
      break;
    case ECallState.ENDED:
      console.log("Call Ended.");
      break;
  }
});

// 3. Initiate the call
await call.start();
```

---

### 3. Handle Incoming Calls

```typescript
// 1. Instant Ring Alert (Trigger Ringing Popup & Play Ringtone)
client.events.on("call.ring", (ringData) => {
  console.log("🔔 Incoming Call Alert!", ringData.call_id);
  console.log("Caller:", ringData.from?.name || ringData.from?.number);
  console.log("Hotline:", ringData.to?.name || ringData.to?.number);
  // Show incoming call modal UI & play ringtone...
});

// 2. Incoming Call WebRTC Offer Ready
client.events.on("call.offer", (incomingCall) => {
  console.log("Call Object Ready:", incomingCall.callId);

  // Bind Remote Stream
  incomingCall.on(ECallEventName.REMOTE_STREAM, (stream) => {
    remoteAudio.srcObject = stream;
    remoteAudio.play();
  });

  // Example: Accept button click handler
  document.getElementById("btn-accept")?.addEventListener("click", async () => {
    await incomingCall.accept();
    console.log("Call Answered!");
  });

  // Example: Reject button click handler
  document.getElementById("btn-reject")?.addEventListener("click", async () => {
    await incomingCall.reject();
  });
});
```

---

## 🎛️ In-Call Operations

Once a call is active (`call` object), you can perform the following controls:

### Mute & Unmute Audio

```typescript
// Mute microphone (stops sending audio)
call.mute();
console.log("Microphone Muted:", call.isMuted);

// Unmute microphone
call.unmute();
console.log("Microphone Muted:", call.isMuted);

// Toggle mute state
const isMutedNow = call.toggleMute();
```

### Hold & Unhold Call

```typescript
// Hold call (sends SDP renegotiation to server)
await call.hold();

// Unhold call
await call.unhold();
```

### Transfer Call

```typescript
// Transfer active call to another agent in team
await call.transfer("agent.jane", "team_support_id");
```

### Send DTMF Tones

```typescript
// Send DTMF keypad digit ('0'-'9', '*', '#') via SIP INFO
await call.sendDTMF("1");
```

### End Call

```typescript
// Hangup / Terminate Call
await call.hangup();
```

---

## 🎧 Call Supervision (Supervisor / Monitor)

Supervisors can monitor ongoing agent calls in 3 modes:

```typescript
// Mode 1: "listen" — Silent Monitoring (Supervisor hears both agent & customer)
const call = await client.superviseCall("cl_123456789", "listen");

// Mode 2: "whisper" — Whisper / Coach (Only the agent hears the supervisor)
const call = await client.superviseCall("cl_123456789", "whisper");

// Mode 3: "barge" — 3-Way Barge-In (Both agent & customer hear supervisor)
const call = await client.superviseCall("cl_123456789", "barge");

// Bind stream and start listening
call.on(ECallEventName.REMOTE_STREAM, (stream) => {
  remoteAudio.srcObject = stream;
  remoteAudio.play();
});

await call.start();
```

---

## 👥 Real-Time Agent Presence & Events

Track team presence and status changes in real-time via Server-Sent Events (SSE):

```typescript
// Listen for agent status changes
client.events.on("agent.state", ({ username, state, team_id }) => {
  console.log(`Agent ${username} is now ${state}`); // "available" | "busy" | "offline"
});

// Change current agent presence status
await client.setPresence("available"); // "available" | "busy" | "offline"
```

---

## 📖 API & Event Reference

### `EClientEventName` (Client Events)

| Event Name | Payload Type | Description |
| :--- | :--- | :--- |
| `call.ring` | `ICallRingParams` | Triggered instantly when an incoming call starts ringing |
| `call.offer` | `Call` | Triggered when the WebRTC call object is ready to answer |
| `agent.state` | `{ username, state }` | Real-time presence updates of team agents |
| `agent.updated` | `Agent` | Fired when an agent profile (name, avatar, email) is updated |
| `agent.created` | `Agent` | Fired when a new agent account is created |
| `agent.deleted` | `{ id, username }` | Fired when an agent account is deleted |
| `team.created` | `Team` | Fired when a workspace team is created |
| `team.updated` | `Team` | Fired when team details/name are updated |
| `team.deleted` | `{ id }` | Fired when a team is deleted |
| `team.assigned` | `{ team_id, agent_id }` | Fired when an agent joins a team |
| `team.unassigned` | `{ team_id, agent_id }` | Fired when an agent leaves a team |
| `contact.created` | `Contact` | Fired when a contact is created |
| `contact.updated` | `Contact` | Fired when contact info is updated |
| `contact.deleted` | `{ id }` | Fired when a contact is deleted |
| `error` | `{ code, message }` | General client errors or authentication failures |

### `ECallEventName` (Call Instance Events)

| Event Name | Payload Type | Description |
| :--- | :--- | :--- |
| `state` | `ISIPCallState` | Call state changes (`INITIATED`, `TRYING`, `RINGING`, `ACTIVE`, `ONHOLD`, `ENDED`) |
| `remoteStream` | `MediaStream` | Fired when remote audio/video stream is available (including Early Media / Ringback) |
| `localStream` | `MediaStream` | Fired when local microphone/camera stream is captured |
| `mediaState` | `RTCIceConnectionState` | WebRTC ICE connection status updates (`connecting`, `connected`, `failed`) |

---

## 📄 License

This SDK is released under the **MIT License**.
