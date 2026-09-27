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
- 💬 **Call Center SMS Conversations** — Complete 2-way SMS inbox, conversation threads, agent assignment, collision avoidance, and real-time delivery status tracking.
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

// 3. Listen to Real-time Speech-to-Text Transcription & Dialogues
call.on(ECallEventName.TRANSCRIPTION_DIALOGUE, (dialogue) => {
  console.log(`[${dialogue.speaker}]: ${dialogue.text} (final: ${dialogue.speech_final})`);
  // Render real-time live chat bubble / speech subtitles...
});

call.on(ECallEventName.TRANSCRIPTION_COMPLETED, (summaryData) => {
  console.log("Call Transcription Completed:", summaryData.full_text);
  console.log("AI Summary:", summaryData.summary);
  console.log("Sentiment:", summaryData.sentiment);
});

// 4. Listen to Call Recording Events
call.on(ECallEventName.RECORDING_STARTED, (event) => {
  console.log("Call Recording Started:", event);
});

call.on(ECallEventName.RECORDING_COMPLETED, (event) => {
  console.log("Call Recording Stopped:", event);
});

// Or listen to all recording events:
call.onRecording((event) => {
  console.log(`Recording Event [${event.type}]:`, event.data);
});

// 5. Initiate the call
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
// Transfer to another agent by username
await call.transfer("agent.jane");

// Transfer to an extension number
await call.transfer("100");

// Transfer to a team
await call.transfer("te_support_team_id");

// Transfer to a SIP account
await call.transfer("si_sip_account_id");

// Transfer with a reason
await call.transfer("agent.jane", "Customer needs billing support");
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

Supervisors and team leaders can monitor ongoing active calls in 3 supervision modes:

```typescript
// Mode 1: "listen" — Silent Monitoring (Supervisor hears both agent & customer)
const call = await client.startSupervision("cl_123456789", "listen");

// Mode 2: "whisper" — Whisper / Coach (Only the agent hears the supervisor)
const call = await client.startSupervision("cl_123456789", "whisper");

// Mode 3: "barge" — 3-Way Barge-In (Both agent & customer hear supervisor)
const call = await client.startSupervision("cl_123456789", "barge");

// Bind remote stream to audio element
call.on(ECallEventName.REMOTE_STREAM, (stream) => {
  remoteAudio.srcObject = stream;
  remoteAudio.play().catch(console.error);
});

// Stop supervision session
await call.hangup();
```

> **Advanced Usage**: You can also use `client.superviseCall(callId, mode)` to fetch session credentials (`{ call_token, ws_url }`) and initialize the session manually via `call.joinSession(res.ws_url, res.call_token)`.

---

## 👥 Real-Time Agent Presence & Events

Track team presence and status changes in real-time via Server-Sent Events (SSE):

```typescript
// Listen for agent status changes
client.events.on("agent.state", ({ username, state }) => {
  // States: "online" | "available" | "incall" | "busy" | "offline"
  console.log(`Agent ${username} is now ${state}`);
});

// Listen for forced state changes by supervisors
client.events.on("agent.state.forced", ({ target_username, new_state, forced_by, reason }) => {
  console.log(`Agent ${target_username} was forced ${new_state} by ${forced_by}: ${reason}`);
});
```

**Agent Presence States:**

| State | Description |
| :--- | :--- |
| `online` | Agent is actively connected via SSE event stream |
| `available` | Agent is reachable via VoIP push (has registered device) but not actively streaming SSE |
| `incall` | Agent is in an active call |
| `busy` | Agent is busy (set manually by agent — Do Not Disturb) |
| `offline` | Agent has no active connections or registered push devices |

### Set Own Presence

```typescript
// Set "Do Not Disturb" — agent won't receive incoming calls
await client.setPresence("busy");

// Return to active state (system determines: "online" or "available")
await client.setPresence("ready");
```

---

## 📊 Real-Time Call Lifecycle Events

In addition to WebRTC signaling, the SDK emits real-time call lifecycle state events over the persistent SSE stream for live dashboard monitoring, active call logs, and call telemetry:

```typescript
// 1. New Call Session Created in Workspace
client.events.on("call.created", ({ data }) => {
  console.log("Call Created:", data.call_id, data.direction, data.number);
});

// 2. Call Ringing / Started
client.events.on("call.started", ({ data }) => {
  console.log("Call Ringing:", data.call_id, "From:", data.from?.number, "To:", data.to?.number);
});

// 3. Call Answered & Bridge Established
client.events.on("call.answered", ({ data }) => {
  console.log("Call Answered:", data.call_id, "Answered at:", data.answer_time);
});

// 4. Call Ended & Final Metrics Available
client.events.on("call.ended", ({ data }) => {
  console.log("Call Ended:", data.call_id, "Duration:", data.duration, "Cause:", data.hangup_cause);
});
```

---

## 💬 Call Center SMS Conversations

Manage two-way SMS/MMS conversations with real-time SSE synchronization:

```typescript
// 1. Fetch SMS Inbox conversations (with filters)
const inbox = await client.getConversations({
  status: "open",
  unread_only: false,
  limit: 20,
});
console.log("Active Threads:", inbox.data.length);

// 2. Fetch conversation message history
const history = await client.getConversationMessages("conv_a1b2c3d4e5f6", { limit: 50 });

// 3. Send outbound SMS reply
const message = await client.sendConversationMessage("conv_a1b2c3d4e5f6", {
  body: "Hello! Thank you for reaching out to Firetell support.",
});

// 4. Mark conversation as read (resets unread badge)
await client.markConversationAsRead("conv_a1b2c3d4e5f6");

// 5. Real-Time SMS Event Listeners
// Inbound customer message
client.events.on("message.received", (data) => {
  console.log("New SMS from:", data.from_number, "Body:", data.body);
  // data: { id, conversation_id, from_number, to_number, body, unread_count, ... }
});

// Outbound message from teammate (prevents collision)
client.events.on("message.sent", (data) => {
  console.log("Teammate replied:", data.body, "by:", data.sender_id);
});

// Carrier delivery status update
client.events.on("message.updated", (data) => {
  console.log("Message status:", data.id, "Status:", data.status);
});

// Thread updated (assigned agent, status open/closed, read receipt)
client.events.on("conversation.updated", (conv) => {
  console.log("Thread updated:", conv.id, "Status:", conv.status, "Unread:", conv.unread_count);
});
```

---

## 📖 API & Event Reference

### `EClientEventName` (Client Events)

| Event Name | Payload Type | Description |
| :--- | :--- | :--- |
| `call.ring` | `ICallRingParams` | Triggered instantly when an incoming call starts ringing (popup alert) |
| `call.offer` | `Call` | Triggered when the WebRTC call object is ready to answer |
| `call.created` | `{ event, workspace_id, data, timestamp }` | Real-time event when a new call is initialized |
| `call.started` | `{ event, workspace_id, data, timestamp }` | Real-time event when a call begins ringing/progressing |
| `call.answered` | `{ event, workspace_id, data, timestamp }` | Real-time event when a call is answered |
| `call.ended` | `{ event, workspace_id, data, timestamp }` | Real-time event when a call finishes (includes duration, hangup_cause, cost) |
| `call.canceled` | `{ event, workspace_id, data, timestamp }` | Triggered when ringing is canceled (call answered elsewhere or timed out) |
| `connection.state` | `'connected' \| 'connecting' \| 'disconnected'` | Real-time connection status updates (handles background drops and reconnects without logging out) |
| `agent.state` | `{ username, state }` | Real-time presence updates (`online`, `available`, `incall`, `busy`, `offline`) |
| `agent.state.forced` | `{ target_username, new_state, forced_by, reason }` | Fired when a supervisor forces an agent's state to `offline` |
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
| `call.recording.ready` | `ICallRecordingReadyEvent` | Fired on workspace stream when call recording file is fully processed and ready to play/download |
| `message.received` | `IMessageReceivedEvent` | Fired when a new inbound SMS message is received from a customer |
| `message.sent` | `IMessageSentEvent` | Fired when an outbound SMS is sent by any agent (prevents collision) |
| `message.updated` | `IMessageUpdatedEvent` | Fired when carrier delivery status transitions (`queued`, `sent`, `delivered`, `failed`) |
| `conversation.updated` | `IConversation` | Fired when a conversation thread status, assignment, or unread count updates |
| `error` | `{ code, message }` | General client errors or authentication failures |

### `ECallEventName` (Call Instance Events)

| Event Name | Payload Type | Description |
| :--- | :--- | :--- |
| `state` | `ISIPCallState` | Call state changes (`INITIATED`, `TRYING`, `RINGING`, `ACTIVE`, `ONHOLD`, `ENDED`) |
| `remoteStream` | `MediaStream` | Fired when remote audio/video stream is available (including Early Media / Ringback) |
| `localStream` | `MediaStream` | Fired when local microphone/camera stream is captured |
| `mediaState` | `RTCIceConnectionState` | WebRTC ICE connection status updates (`connecting`, `connected`, `failed`) |
| `mute` | `{ muted: boolean }` | Fired when local microphone is muted or unmuted |
| `transcription` | `TranscriptionEvent` | Consolidated real-time speech transcription lifecycle events |
| `transcription.started` | `ITranscriptionStartedEvent` | Fired when real-time speech-to-text session begins |
| `transcription.dialogue` | `ITranscriptionDialogueEvent` | Fired on each live speech dialogue chunk / subtitle |
| `transcription.completed` | `ITranscriptionCompletedEvent` | Fired when full call transcription, summary, and sentiment analysis finish |
| `recording` | `CallRecordingEvent` | Consolidated call recording lifecycle events |
| `recording.started` | `ICallRecordingStartedEvent` | Fired when audio recording starts |
| `recording.completed` | `ICallRecordingCompletedEvent` | Fired when audio recording finishes |

---

## 📄 License

This SDK is released under the **MIT License**.
