---
name: sdk-architecture
description: >
  Core architecture and conventions of firetell-client-sdk.
  Trigger on: any modification to FiretellClient.ts, Call.ts, SimpleEventEmitter.ts,
  or when adding new features, methods, events, or enums to the SDK.
---

# SDK Architecture & Conventions

## Project Overview

`@firetell/firetell-client-sdk` is a TypeScript WebRTC/SIP signaling SDK that enables audio/video calls via WebSocket (JSON-RPC 2.0). It targets both browser (IIFE, ESM) and Node.js (CJS) environments.

## File Structure

```
src/
├── FiretellClient.ts          # Main signaling client (WebSocket, JSON-RPC, session management)
├── Call.ts                     # WebRTC call instance (media, SDP, call control)
├── SimpleEventEmitter.ts       # Lightweight typed event emitter with on/once/off/emit/offAll
├── index.ts                    # Public API exports
├── enums/
│   ├── ECallState.enum.ts      # Call lifecycle states (INITIATED → ACTIVE → ENDED)
│   ├── ECallEventName.enum.ts  # Call-level event names
│   ├── EClientEventName.enum.ts# Client-level event names
│   ├── ELocalStorageKey.enum.ts# localStorage key constants
│   └── EMessageNotification.enum.ts # JSON-RPC method names
└── interfaces/
    ├── ISession.ts             # Authenticated session shape
    ├── ICallOptions.ts         # Call constructor options
    ├── IActiveCall.ts          # Reconnect response shape
    ├── IJwtPayload.ts          # Decoded JWT payload
    └── IRPCMessageResult.ts    # JSON-RPC response/error shapes
```

## Architecture Principles

### 1. Two-Layer Design
- **Signaling Layer** (`FiretellClient`): WebSocket connection, JSON-RPC messaging, session auth, heartbeat, reconnection. Does NOT manage media.
- **Media Layer** (`Call`): WebRTC peer connection, getUserMedia, SDP negotiation, ICE gathering, audio/video tracks. Calls `FiretellClient` methods for signaling.

### 2. Full ICE (Not Trickle)
FreeSwitch does NOT support Trickle ICE. The SDK gathers ALL ICE candidates before sending the SDP to the server. See `Call.getSDPFull()`.

### 3. JSON-RPC 2.0 over WebSocket
- **Requests**: `{ jsonrpc: "2.0", method, params, id }` — client sends, awaits response
- **Notifications**: Server pushes `{ notification: "<event>", params }` (no jsonrpc field)
- **Pending transactions**: Map<id, {resolve, reject}> with 30s timeout

### 4. Notification Handler Map
`FiretellClient` uses a `Map<EMessageNotification, handler>` instead of if-else chains. Each notification type has its own handler method:
- `_handleCallState()` for `call.state`
- `_handleIncomingCall()` for `call.offer`
- `_handleCallMute()` for `call.mute`
- `_keepAlive()` for `session.ping`

When adding a new notification handler:
1. Add the enum value to `EMessageNotification`
2. Create a typed params interface (e.g., `INewNotificationParams`)
3. Add a private `_handleXxx()` method
4. Register in the `notificationHandlers` Map in the class body

### 5. Event Emitter Pattern
Both `FiretellClient` (via `.events`) and `Call` (extends `SimpleEventEmitter`) use events.
- **Client events**: `session`, `error`, `call.offer`, `call.mute`, `workspace.agent.state`, `reconnected`
- **Call events**: `state`, `localStream`, `remoteStream`, `mediaState`, `mute`

When adding new events:
1. Add enum value to `EClientEventName` or `ECallEventName`
2. Emit via `this.events.emit(...)` or `this.emit(...)`
3. Document in README.md

### 6. Lifecycle Management
- `FiretellClient.logout()` — sends hangup for active calls, clears session, disconnects WS
- `FiretellClient.destroy()` — full cleanup without server communication (timers, WS, calls, listeners, auth state)
- `Call.destroy()` — best-effort hangup, closes peer connection, stops media tracks, removes listeners

## Coding Conventions

### TypeScript
- **No `any`** — use `unknown` and type assertions, or typed interfaces
- **No `catch → return Promise.reject()`** — use `throw` in async functions
- **Access modifiers** — explicit `public`/`private` on all members
- **`readonly`** for immutable public properties (e.g., `activeCalls`, `sdkVersion`, `ready`)

### Naming
- Private methods: `_camelCase` prefix (e.g., `_initWebSocket`, `_handleCallState`)
- Public methods: `camelCase` (e.g., `sendHold`, `makeCall`)
- Enums: `E` prefix + PascalCase (e.g., `ECallState`, `EClientEventName`)
- Interfaces: `I` prefix + PascalCase (e.g., `ISession`, `IJwtPayload`)
- Internal types within FiretellClient.ts: `I` prefix interfaces (e.g., `IRPCRequest`, `ICallStateParams`)

### Error Handling
- Throw `new Error(message)` directly — no wrapping in `Promise.reject()`
- Use typed error codes in events: `{ code: number, message: string }`
- Known codes: 400 (invalid message), 401 (auth), 500 (internal), 606 (WebRTC unsupported)

### WebSocket
- Single `_initWebSocket()` method for both initial connect and reconnect
- `_disconnect()` removes all handlers before closing to prevent reconnect loops
- `_reconnect()` uses exponential backoff (3s × 1.5^n, max 25s, max 30 retries)

## Build & Output

- **Build tool**: tsup
- **Formats**: CJS (`dist/index.js`), ESM (`dist/index.mjs`), IIFE (`dist/index.global.js`) with `globalName: "Firetell"`
- **Type definitions**: `dist/index.d.ts`, `dist/index.d.mts`
- **Source maps**: enabled
- **Build command**: `npm run build`

## Public API (index.ts exports)

```typescript
export { FiretellClient }    // Main class
export { Call }              // Call class
export { ECallState }        // Call states enum
export { ECallEventName }    // Call event names enum
export { EClientEventName }  // Client event names enum
export type { ISession }     // Session interface
export type { CallOptions }  // Call constructor options
export type { IActiveCall }  // Reconnect response
```

When adding new public APIs, always update `index.ts` exports.
