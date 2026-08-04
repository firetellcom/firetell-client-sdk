# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-08-04

### Added & Fixed
- **Complete Real-Time Event Stream Support**: Added event forwarding for team events (`team.created`, `team.updated`, `team.deleted`, `team.assigned`, `team.unassigned`) and agent profile/presence updates (`agent.updated`, `agent.deleted`, `agent.state`, `agent.state.forced`).
- **Dynamic SSE Fallback Listener**: Added automatic `onmessage` listener on `EventSource` so any custom or new SSE event emitted by backend is automatically forwarded through `client.events.emit(eventName, data)`.

## [1.0.2] - 2026-08-04

### Changed & Refactored

- **Per-Call Dedicated WebSocket Signaling**: Encapsulated dedicated native WebSocket connection per `Call` instance (`call.connectSignaling()`) using single-use `call_token` generated via REST API `POST /v1/call-center/calls`.
- **Automatic Event Handling**: Implemented self-contained signaling event listeners per call (`call.offer`, `call.answered`, `call.held`, `call.unheld`, `call.ended`, `call.rejected`, `call.canceled`, `call.state`, `session.error`).

### Fixed

- **WebRTC State Machine**: Fixed `setRemoteDescription()` state validation in `Call.ts` to allow remote SDP offers in `"stable"` state to transition to `"have-remote-offer"` before `createAnswer()`.
- **Call Transfer Lifecycle**: Updated `Call.transfer()` to stop local media tracks without abruptly closing client WebSocket, letting server gracefully complete transfer signaling.
- **Incoming Call UI Event Emission**: Emitted `EClientEventName.CALL_OFFER` on `client.events` upon receiving `call.offer` so UI bindings populate incoming call details correctly.

### Infrastructure & Build

- **Automatic Version Injection**: Configured `tsup.config.ts` compile-time `__SDK_VERSION__` define to automatically sync SDK version from `package.json` into builds.

## [1.0.0] - 2026-01-01

### Added

- Initial release of `@firetell/firetell-client-sdk`
- WebRTC audio/video calls via native per-call WebSocket signaling
- JWT-based session authentication (`session.connect`)
- Outbound call support (`Call.start()`)
- Incoming call handling (`Call.accept()`, `Call.reject()`)
- Call control: hold/unhold, mute/unmute, DTMF, transfer
- Auto-reconnect with exponential backoff (max 30 retries)
- Heartbeat mechanism (`session.ping/pong`) with stale detection
- Agent presence notifications (`workspace.agent.state`)
- Active call recovery after reconnection
- Full ICE gathering (non-Trickle) for FreeSwitch compatibility
- Multi-format builds: CJS, ESM, IIFE with TypeScript declarations
- Typed event emitter for both client and call events
