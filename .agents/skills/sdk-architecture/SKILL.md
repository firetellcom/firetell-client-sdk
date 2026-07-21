---
name: sdk-architecture
description: >
  Core architecture and conventions of firetell-client-sdk.
  Trigger on: any modification to FiretellClient.ts, Call.ts, SimpleEventEmitter.ts,
  or when adding new features, methods, events, or enums to the SDK.
---

# SDK Architecture & Conventions

## Project Overview

`@firetell/firetell-client-sdk` is a TypeScript WebRTC/VoIP SDK that enables audio/video calls via REST API initiation, native WebSockets per call, and Server-Sent Events (SSE) for background business events. It targets both browser (IIFE, ESM) and Node.js (CJS) environments.

## File Structure

```
src/
├── firetell-client.ts          # Main signaling client (REST Make Call, Native WS per-call, SSE stream)
├── call.ts                     # WebRTC call instance (media, SDP, call control)
├── simple-event-emitter.ts     # Lightweight typed event emitter with on/once/off/emit/offAll
├── index.ts                    # Public API exports
├── constants/
│   └── api-endpoints.ts        # REST & SSE API endpoint URLs
├── enums/
│   ├── index.ts                # Barrel export
│   ├── call-state.enum.ts      # Call lifecycle states (INITIATED → ACTIVE → ENDED)
│   ├── call-event-name.enum.ts # Call-level event names
│   └── client-event-name.enum.ts # Client-level event names
└── interfaces/
    ├── index.ts                # Barrel export
    ├── session.interface.ts    # Authenticated session shape
    ├── call-options.interface.ts # Call constructor options
    └── jwt-payload.interface.ts # Decoded JWT payload
```

## Architecture Principles

### 1. Unified Call Architecture
- **State Mutation & Call Initiation**: HTTP REST API (`POST /api/v1/call-center/calls` returns `call_id` + `call_token` + `ws_url`).
- **Media Signaling Layer**: Native WebSocket per call session, authenticated via `call_token` sent in `session.connect` within 3 seconds.
- **Event Observation Layer**: Server-Sent Events (SSE) stream (`GET /api/v1/call-center/events/stream`) for agent presence, queue stats, and notifications.

### 2. Full ICE (Not Trickle)
FreeSwitch requires Full ICE. The SDK gathers ALL ICE candidates before sending the SDP to the server. See `Call.getSDPFull()`.

### 3. Native Event-Based WebSocket Messaging
- Simple `{ "event": string, "data": object }` JSON payload.
- No `rpc-websockets` or `socket.io` dependencies.

### 4. Event Emitter Pattern
Both `FiretellClient` (via `.events`) and `Call` (extends `SimpleEventEmitter`) use events.
- **Client events**: `session`, `error`, `call.offer`, `workspace.agent.state`
- **Call events**: `state`, `localStream`, `remoteStream`, `mediaState`, `mute`

### 5. Lifecycle Management
- `FiretellClient.logout()` — sends hangup for active calls, closes SSE, disconnects WS
- `FiretellClient.destroy()` — full cleanup without server communication
- `Call.destroy()` — closes peer connection, stops media tracks, removes listeners
