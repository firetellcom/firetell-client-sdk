---
name: sdk-architecture
description: >
  Core architecture and conventions of firetell-client-sdk.
  Trigger on: any modification to firetell-client.ts, call.ts, src/utils/,
  or when adding new features, methods, events, or enums to the SDK.
---

# SDK Architecture & Conventions

## Project Overview

`@firetell/firetell-client-sdk` is a TypeScript WebRTC/VoIP SDK that enables audio/video calls via REST API initiation, native WebSockets per call, and Server-Sent Events (SSE) for background business events. It targets both browser (IIFE, ESM) and Node.js (CJS) environments.

## File Structure

```
src/
├── index.ts                    # Public API exports
├── firetell-client.ts          # Main client (REST initiation, Call supervision, SSE event dispatch)
├── call.ts                     # WebRTC call instance (per-call WebSocket signaling, Full ICE SDP, WebRTC media)
├── constants/
│   ├── index.ts                # Barrel export
│   ├── api-endpoints.ts        # REST and SSE API endpoint paths
│   └── ice-servers.ts          # Default STUN/TURN ICE server configuration
├── enums/
│   ├── index.ts                # Barrel export
│   ├── call-state.enum.ts      # Call lifecycle states (INITIATED → CONNECTING → ACTIVE → ENDED)
│   ├── call-event-name.enum.ts # Call-level event names (state, localStream, remoteStream, etc.)
│   ├── client-event-name.enum.ts # Client-level event names (call.ring, call.created, agent.state, etc.)
│   ├── storage-key.enum.ts     # localStorage key constants
│   └── message-notification.enum.ts # Native WebSocket per-call event names
├── interfaces/
│   ├── index.ts                # Barrel export
│   ├── session.interface.ts    # Authenticated session shape
│   ├── call-options.interface.ts # Call constructor options
│   ├── active-call.interface.ts # Active call sync shape
│   ├── jwt-payload.interface.ts # Decoded JWT payload
│   └── ws-message.interface.ts # Event-based WebSocket message shapes
└── utils/
    ├── index.ts                # Barrel export
    ├── simple-event-emitter.ts # Lightweight typed event emitter (on, once, off, emit, offAll)
    └── sse-stream.ts           # Zero-dependency Header-based SSE stream client (fetch + ReadableStream)
```

## Architecture Principles

### 1. Unified Call Architecture

- **State Mutation & Call Initiation**: HTTP REST API (`POST /v1/call-center/calls` returns `call_id` + `call_token` + `ws_url`).
- **Call Supervision**: `startSupervision(callId, mode)` initiates supervisor channel via REST API (`POST /v1/call-center/calls/:id/supervision`), then joins signaling via `call.joinSession(ws_url, call_token, mode)` using WebRTC `recvonly` (for `listen` mode) without activating supervisor microphone.
- **Media Signaling Layer**: Native WebSocket per call session, authenticated via `call_token` sent in `session.connect` within 3 seconds.
- **Event Observation Layer**: Persistent Server-Sent Events (SSE) stream (`GET /stream`) connecting via `SseStreamClient` with `Authorization: Bearer <jwt>` header (no token query param on URL).

### 2. Full ICE (Not Trickle)

Firetell's Media Server requires Full ICE. The SDK gathers ALL ICE candidates before sending the SDP offer/answer to the server. See `Call._getSDPFull()`.

### 3. Native Event-Based WebSocket Messaging (No JSON-RPC)

- Simple `{ "event": string, "data": object }` JSON payload.
- No JSON-RPC 2.0, no `rpc-websockets`, and no `socket.io` dependencies.

### 4. Event Emitter Pattern

Both `FiretellClient` (via `.events`) and `Call` (extends `SimpleEventEmitter`) use typed events.

- **Client events**: `session`, `error`, `call.ring`, `call.offer`, `call.created`, `call.started`, `call.answered`, `call.ended`, `call.canceled`, `agent.state`, `workspace.agent.state`
- **Call events**: `state`, `localStream`, `remoteStream`, `mediaState`, `mute`

### 5. Lifecycle Management

- `FiretellClient.logout()` — sends hangup for active calls, closes SSE stream, cleans up sessions
- `FiretellClient.destroy()` — full client cleanup and listener detachment without server communication
- `Call.destroy()` — closes peer connection, stops media tracks, removes listeners, closes WebSocket
