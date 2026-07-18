# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-01

### Added

- Initial release of `@firetell/firetell-client-sdk`
- WebRTC audio/video calls via WebSocket signaling (JSON-RPC 2.0)
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
