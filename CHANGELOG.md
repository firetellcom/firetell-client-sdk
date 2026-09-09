# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.4] - 2026-09-09

### Added

- **Camera Mute/Unmute (Toggle Camera)**:
  - Added `call.muteVideo()`, `call.unmuteVideo()`, and `call.toggleCamera()` methods on `Call`.
  - Added `call.isCameraOff: boolean` property tracking local camera state.
  - Added `ECallEventName.CAMERA` (`"camera"`) event emitted locally and on remote camera state updates via signaling.
- **Native Screen Sharing (`getDisplayMedia` + `replaceTrack`)**:
  - Added `call.startScreenShare()`, `call.stopScreenShare()`, and `call.toggleScreenShare()` on `Call`.
  - Seamlessly replaces video track on the active `RTCRtpSender` without SDP renegotiation or call interruption.
  - Automatically restores the original camera video track when the user stops sharing screen.
  - Added `call.isScreenSharing: boolean` property tracking active screen share state.
  - Added `ECallEventName.SCREEN_SHARE` (`"screenShare"`) event emitted locally and on remote screen share updates.
- **SDP Video Auto-Detection in `call.offer` & `accept()`**:
  - `Call.handleWsMessage`: Automatically falls back to inspecting the remote SDP offer for active video media sections (`/m=video [1-9]/`) if the explicit `is_video` boolean flag is omitted in the `call.offer` payload, ensuring `call.isVideo` is reliably set on the callee side.
  - `Call.accept()`: Evaluates `this.remoteDescription.sdp` to guarantee `this.isVideo` is true before setting up local media, prompting the browser for both Camera and Microphone permissions (`{ video: true, audio: true }`).
- **Resilient Remote Stream Track Assembly**:
  - Improved `RTCPeerConnection.ontrack` in `_setupWebrtcMedia`: Automatically creates a `MediaStream` and attaches tracks incrementally if `event.streams[0]` is missing, ensuring both remote audio and video tracks are emitted via `ECallEventName.REMOTE_STREAM`.
- **Caller Metadata Continuity**:
  - Added support for `from_avatar` and `transfer_reason` fields in `call.offer` event processing so callee avatar and transfer context remain intact through WebRTC session negotiation.

### Fixed

- **Callee Video Negotiation**:
  - Fixed an issue where incoming video calls defaulted to audio-only on the callee side due to missing `is_video` flag in signaling WebSocket payloads.
- **Example Demo Web App**:
  - Fixed `hideIncomingBanner` reference error on call dismissal.
  - Added dynamic `updateVideoUI()` helper to automatically bind and display local/remote video elements when tracks arrive.

## [1.2.3] - 2026-09-04

### Changed

- **`call.transfer()` simplified** (**Breaking**):
  - Signature changed from `transfer(targetUsername, teamId?, reason?)` to `transfer(target, reason?)`.
  - `target` now accepts: agent username, extension number (e.g. `"100"`), team ID (`te_...`), or SIP account ID (`si_...`).
  - Removed `teamId` parameter — target type is auto-resolved server-side via prefix-based resolution.
- **`FiretellClient.sendTransfer()` simplified** (**Breaking**):
  - Signature changed from `sendTransfer(callId, targetUsername, teamId?, reason?)` to `sendTransfer(callId, target, reason?)`.
  - HTTP fallback body changed from `{ target_username, team_id, reason }` to `{ target, reason }`.
- **Per-call WebSocket payloads cleaned up**:
  - Removed redundant `call_id` from all WS event payloads (`call.hangup`, `call.answer`, `call.reject`, `call.transfer`, `call.dtmf`, `call.mute`, `call.hold`, `call.unhold`). The per-call WS connection inherently binds the socket to a specific call, making `call_id` unnecessary.
  - `call.transfer` payload field renamed from `to` to `target` for consistency with the HTTP API.

## [1.2.2] - 2026-09-03

### Added

- **`getPhoneNumbers()` REST API on `FiretellClient`**:
  - Added `public async getPhoneNumbers(options?: { page?: number; limit?: number }): Promise<IClientPhoneNumbersResponse>` to query phone numbers (DIDs) accessible by the authenticated agent and their shared teams.
  - Automatically sends the agent's JWT to `GET /api/v1/call-center/phone-numbers`.
  - Added `API_ENDPOINTS.PHONE_NUMBERS` (`"/api/v1/call-center/phone-numbers"`).
  - Added `IClientPhoneNumber` and `IClientPhoneNumbersResponse` interfaces exporting phone number details (`id`, `number`, `title`, `country_code`, `dial_code`, `status`, `capabilities`, `enable_outbound`, `shared_teams_id`).
- **Static & Named SDK Version Exports**:
  - Added static `FiretellClient.VERSION` property on the class for direct, synchronous version access without instantiation.
  - Exported `SDK_VERSION` constant directly from package root (`import { SDK_VERSION } from '@firetell/firetell-client-sdk'`).
  - Added `"./package.json": "./package.json"` to the package `exports` map for direct version inspection by package managers and bundlers.

## [1.2.1] - 2026-08-22

### Added

- **`transfer_reason` in `call.ring` Event & `Call` Instance**:
  - Added `transfer_reason?: string` to `ICallRingParams` payload in the `call.ring` SSE event.
  - Exposed `call.transferReason?: string` on the `Call` instance when a transferred call session is initialized.
  - Allows frontends, Webphones, and Console agents to display the contextual transfer reason provided by Voice AI agents (e.g., *"Customer requested receptionist for billing inquiry"*) or human agents during ringing before and after answering.
  - Updated `example/index.html` demo to display `transfer_reason` in the incoming call banner and event log.

## [1.2.0] - 2026-08-20

### Added

- **Dedicated Per-Call SSE Event Stream (`Call.connectCallEventStream`)**:
  - Automatically establishes a lightweight, dedicated SSE connection (`/stream?call_id=<callId>`) for each active call session (`call.start()`, `call.accept()`, `call.joinSession()`, and `client.createCallSession()`).
  - Subscribes to the Per-Call channel and receive real-time speech-to-text transcriptions, recordings events, and telemetry without flooding the global workspace event stream.
  - Automatically disconnects and cleans up the stream upon call termination (`call.destroy()`).
- **Call-Scoped Real-Time Transcription Events & APIs**:
  - Added `ECallEventName.TRANSCRIPTION` (`"transcription"`), `ECallEventName.TRANSCRIPTION_STARTED` (`"transcription.started"`), `ECallEventName.TRANSCRIPTION_DIALOGUE` (`"transcription.dialogue"`), and `ECallEventName.TRANSCRIPTION_COMPLETED` (`"transcription.completed"`).
  - Added ergonomic helper listener methods on `Call`: `call.onDialogue((dialogue) => ...)` and `call.onTranscription((event) => ...)`.
  - Exported TypeScript interfaces: `ITranscriptionStartedEvent`, `ITranscriptionDialogueEvent`, `ITranscriptionCompletedEvent`, and `TranscriptionEvent`.
- **Call-Scoped Real-Time Recording Events & APIs**:
  - Added `ECallEventName.RECORDING` (`"recording"`), `ECallEventName.RECORDING_STARTED` (`"recording.started"`), `ECallEventName.RECORDING_COMPLETED` (`"recording.completed"`), and `ECallEventName.RECORDING_READY` (`"recording.ready"`).
  - Added ergonomic helper listener method on `Call`: `call.onRecording((event) => ...)`.
  - Exported TypeScript interfaces: `ICallRecordingStartedEvent`, `ICallRecordingCompletedEvent`, `ICallRecordingReadyEvent`, and `CallRecordingEvent`.
- **Public Getters on `FiretellClient`**:
  - Added `client.getBaseUrl()` and `client.getJwt()` getters.

### Changed & Improved

- **Strict Single-Emission & Call-Scoped Event Architecture**:
  - Removed duplicate event emissions across `FiretellClient._initEventStream()` and `Call._handleSseMessage()`.
  - Decoupled per-call transcription events from `client.events`, strictly routing all live subtitles, chunks, and summaries directly to the owning `Call` instance (`call.on(...)`).
  - Decoupled WebSocket signaling (`_handleWsMessage`) to handle exclusively Firetell WebRTC signaling (`call.offer`, `call.answered`, `call.state`, etc.), isolating SSE transport for transcription.
- **Example Page Updated**:
  - Added `transcription.started` and `transcription.completed` event logging to `example/index.html`.

## [1.1.7] - 2026-08-17

### Added

- **`FiretellClient.stopSupervision()`**: Added helper method to terminate an ongoing call supervision session (cleans up WebRTC call session and calls REST API `DELETE /v1/call-center/calls/:id/supervision`).
- **Call State Monotonicity Guard**: Added automatic state ranking guard in `FiretellClient` to prevent late/out-of-order `call.created` events from overriding or regressing active call state machine (`status` is preserved at highest rank).

## [1.1.6] - 2026-08-17

### Added

- **`SseStreamClient` (Header-Based SSE Streaming)**: Integrated lightweight, zero-dependency SSE stream client with `Authorization: Bearer <jwt>` HTTP header support via `fetch` and `ReadableStream`, completely eliminating JWT token exposure in SSE stream URLs and server access logs.
- **SSE Stream Exports**: Exported `SseStreamClient`, `SseMessageEvent`, and `SseStreamConfig` from SDK entry point for custom streaming requirements.

## [1.1.5] - 2026-08-17

### Added

- **`FiretellClient.startSupervision()`**: Added high-level helper method to initiate call supervision (`listen`, `whisper`, `barge`) and automatically establish WebRTC audio session in one call.
- **`Call.joinSession()`**: Added method to connect signaling and send WebRTC offer using pre-generated `call_token` and `ws_url`.
- **`ISupervisionResponse.ws_url`**: Added required `ws_url` field to `ISupervisionResponse` interface to support dedicated per-call WebSocket connections.

### Changed & Improved

- **Replaced `superviseCall` Public API**: Made `_superviseCall()` internal/private in favor of the unified `startSupervision(callId, mode)` public API, encapsulating the entire REST token exchange and WebRTC audio connection in one step.
- **Flexible `CallOptions` in `Call` Constructor**: Made `to` parameter optional in `CallOptions` with default fallbacks, simplifying supervisor and session-joining call creation.
- **Consistent Private Method Naming**: Standardized all internal helper methods across `Call` and `FiretellClient` with `_` prefix convention (`_extractSdpInit`, `_handleWsMessage`, `_setupWebrtcMedia`, `_getSDPFull`, `_cleanupPeerConnection`, `_superviseCall`, `_isVideoCall`).

## [1.1.4] - 2026-08-15

### Fixed

- **Call Creation**: Renamed `_createCallSession` to `createCallSession`.

## [1.1.3] - 2026-08-14

### Added

- **Real-Time Call Lifecycle Event Enums**: Added `EClientEventName.CALL_CREATED` (`"call.created"`), `EClientEventName.CALL_STARTED` (`"call.started"`), and `EClientEventName.CALL_ANSWERED` (`"call.answered"`) to `client-event-name.enum.ts`.
- **SSE Stream Forwarding**: Added EventSource forwarding for `call.created`, `call.started`, and `call.answered` events in `FiretellClient._initEventStream()`.
- **Active Call State Synchronization**: Added automatic transition of active calls to `ECallState.ACTIVE` / `ANSWERED` when receiving `call.answered` over the SSE stream.

### Changed & Improved

- **Wrapped Data Payload Compatibility**: Enhanced `call.ended`, `call.canceled`, and `call.answered` SSE listeners in `FiretellClient` to seamlessly extract `call_id` and call details from both nested `{ event, workspace_id, data: { call_id, ... }, timestamp }` payloads and direct `{ call_id }` payloads.

## [1.1.2] - 2026-08-14

### Added

- **Client Event Enum Values (`CALL_ENDED` & `CALL_CANCELED`)**: Added `EClientEventName.CALL_ENDED` (`"call.ended"`) and `EClientEventName.CALL_CANCELED` (`"call.canceled"`) to `client-event-name.enum.ts` for unified application-level call lifecycle subscription.
- **SSE Stream Listeners for Early Call Cancellation**: Added persistent `call.canceled` and `call.ended` EventSource listeners in `FiretellClient._initEventStream()`. Automatically cleans up `Call` instances and dismisses incoming call ringing UI modals when calls are answered by another agent or canceled before WebSocket connection completion.
- **Architectural Documentation**: Added detailed JSDoc comments in `FiretellClient` explaining the dual-layer signaling architecture between persistent background SSE streams and on-demand per-call WebSocket sessions.

### Fixed

- **Client-Level Event Notification on Early Termination**: Fixed hanging incoming call ringing UI when server sends `call.ended` or `call.canceled` immediately upon connection. `Call.handleWsMessage()` now dispatches `EClientEventName.CALL_ENDED` and `EClientEventName.CALL_CANCELED` directly to `client.events`, ensuring UI components can dismiss incoming call notifications even if `call.offer` was never dispatched.

## [1.1.1] - 2026-08-12

### Fixed

- **Inbound Call DTLS Setup Role Validation**: Fixed `Answerer must use either active or passive value for setup attribute` error during callee-initiated unhold (`Call.unhold()`). Excluded `a=setup:actpass` from `currentRemoteSetupRole` recording so offer-stage `actpass` attributes are never inserted into WebRTC renegotiation answer descriptions.
- **Optimized Full ICE Gathering**: Fixed 10s ICE gathering timeout during `Call.accept()` / `Call.start()`. Added `onicegatheringstatechange` listener, reduced hard safety timeout to 6s, and implemented a 3s fallback timer that strictly verifies the presence of STUN Public IP (`typ srflx`) or Relay (`typ relay`) candidates in `localDescription` before early resolution.

## [1.1.0] - 2026-08-12

### Fixed

- **DTLS SSL Role Preservation on Renegotiation**: Fixed `Failed to set SSL role for the transport` error during caller-initiated hold (`call.onhold()`). Preserves established DTLS `a=setup` role (`active` / `passive`) in `setRemoteDescription()` across renegotiation answers from Media Server.
- **Incoming Call Accept Error Safety**: Added `try...catch` block around `Call.accept()` to guarantee proper media cleanup and `ECallState.ERROR` state emission if microphone access or WebRTC answer creation fails.

## [1.0.9] - 2026-08-12

### Fixed

- **Call Unhold Event Signaling**: Fixed WS event name emitted during `Call.unhold()` from `"call.hold"` to `"call.unhold"`. Updated post-unhold state transition to `ECallState.ACTIVE`.
- **WebRTC Remote SDP Parsing**: Added `extractSdpInit()` helper in `Call.ts` to safely parse SDP payloads received in WebSocket messages (`call.held`, `call.unheld`, `call.offer`, `call.answered`, `call.sdp`, `call.state`). Prevents `TypeError` when receiving raw SDP string from server, ensuring remote WebRTC audio media stream is properly renegotiated and unmuted on unhold.
- **Immediate State Event Emission**: Added immediate local `ECallEventName.STATE` event emission upon invoking `Call.onhold()` and `Call.unhold()` for responsive UI state updates.
- **ICE Server Fallback**: Created `DEFAULT_ICE_SERVERS` constant (Google STUN + Cloudflare STUN 3478) and configured it as fallback for both `FiretellClient` and `Call.setupWebrtcMedia()`.

## [1.0.8] - 2026-08-11

### Fixed

- **SDP-only State Update Pollution**: Separated the handlers for `call.sdp` and `call.state` WebSocket events. Now, receiving early media or progress SDP updates (`call.sdp` / `183 Session Progress`) will only set the remote WebRTC description without incorrectly emitting a state transition event containing `state: undefined` to the client application.

## [1.0.7] - 2026-08-07

### Changed

- **SSE Endpoint Migration**: Updated `EVENT_STREAM` target path to `/stream` to support the new standalone high-performance `firetell-sse-service` microservice architecture.

## [1.0.6] - 2026-08-06

### Added

- **SSE Reconnection Exponential Backoff**: Implemented exponential backoff with random jitter for automatic background reconnection.

### Changed & Fixed

- **Timer Safety**: Clears active reconnect timers on session cleanup and SDK destroy to avoid background connection leaks.
- **Strict Typing**: Typed `reconnectTimer` using `ReturnType<typeof setTimeout>` instead of `any`.

## [1.0.5] - 2026-08-06

### Added

- **SSE Connection State Tracking**: Added `connection.state` event (`'connected' | 'connecting' | 'disconnected'`) to EClientEventName.
- **SSE Connection Limit Handling**: Listens to the `system.error` SSE event with code `SSE_LIMIT_EXCEEDED` to gracefully close EventSource connection and clear session.

### Changed & Fixed

- **Improved Network Resiliency**: SDK now emits `connection.state` updates for temporary network drops without clearing the session state, avoiding forced logouts.

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
- Full ICE gathering (non-Trickle) for Media Server compatibility
- Multi-format builds: CJS, ESM, IIFE with TypeScript declarations
- Typed event emitter for both client and call events
