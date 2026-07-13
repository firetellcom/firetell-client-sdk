---
name: webrtc-call-flow
description: >
  WebRTC call flow patterns for firetell-client-sdk.
  Trigger on: any work involving Call.ts, WebRTC, peer connection, SDP,
  ICE candidates, getUserMedia, media streams, hold/unhold, mute/unmute,
  call lifecycle, or adding new call features.
---

# WebRTC Call Flow

## Call Lifecycle State Machine

```
Outbound:  INITIATED → TRYING → RINGING → ANSWERED → ACTIVE → ENDED/ERROR
Inbound:   (call.offer received) → accept() → ANSWERED → ACTIVE → ENDED/ERROR
Hold:      ACTIVE → ONHOLD → ACTIVE
Cancel:    any → CANCEL
```

## Outbound Call Flow

```
1. new Call(client, options)
2. call.start()
   ├─ setupWebrtcMedia() → getUserMedia → addTracks to PeerConnection
   ├─ createOffer() → setLocalDescription()
   ├─ getSDPFull() → wait for all ICE candidates (null candidate = done)
   └─ client.makeCall(call, sdp) → sends call.offer via JSON-RPC
3. Server notification: call.state TRYING → RINGING → ANSWERED (with remote SDP)
4. Call.setRemoteDescription(sdp) → media flows
```

## Inbound Call Flow

```
1. Server notification: call.offer { call_id, caller, number, sdp, is_transfer }
2. SDK creates Call instance, sets remoteDescription, emits "call.offer" event
3. Consumer calls call.accept()
   ├─ setupWebrtcMedia() → getUserMedia → addTracks
   ├─ setRemoteDescription(offer SDP)
   ├─ createAnswer() → setLocalDescription()
   ├─ getSDPFull() → wait for all ICE candidates
   └─ client.sendAccept(callId, sdp) → sends call.answer via JSON-RPC
```

## Full ICE Gathering (getSDPFull)

FreeSwitch requires Full ICE. The `getSDPFull()` method:
1. Checks if `iceGatheringState === "complete"` — if so, return immediately
2. Otherwise, listens for `onicecandidate` events
3. When `event.candidate === null`, all candidates gathered → resolve with localDescription
4. 10s timeout → reject with error

**NEVER use Trickle ICE with this SDK.**

## Hold / Unhold

Hold uses SDP renegotiation:
```
Hold:   set transceiver direction = "sendonly" → createOffer → setLocalDescription
        → client.sendHold() → server returns answer SDP → setRemoteDescription
Unhold: set transceiver direction = "sendrecv" → createOffer → setLocalDescription
        → client.sendUnHold() → server returns answer SDP → setRemoteDescription
```

## Mute / Unmute

Mute is client-side track control + server notification:
```
Mute:   localStream.getAudioTracks().forEach(t => t.enabled = false)
        → client.sendMute(callId, true) → emit "mute" event
Unmute: localStream.getAudioTracks().forEach(t => t.enabled = true)
        → client.sendMute(callId, false) → emit "mute" event
```

## PeerConnection Configuration

```typescript
new RTCPeerConnection({
  iceServers: client.iceServers.length
    ? client.iceServers          // From workspace metadata
    : [{ urls: "stun:stun.l.google.com:19302" }]  // Fallback
});
```

ICE servers are fetched from `GET /api/v1` during initialization.

## Call Cleanup (destroy)

```
1. If active → best-effort sendHangup (catch errors silently)
2. Set active = false, client = null
3. cleanupPeerConnection:
   ├─ Remove all PeerConnection event handlers
   ├─ Close PeerConnection
   ├─ Stop all local media tracks
   └─ Emit null for localStream/remoteStream
4. offAll() → remove all event listeners
```

Uses `_destroying` flag to prevent infinite loop (destroy → hangup → destroy).

## Events Emitted by Call

| Event | Payload | When |
|-------|---------|------|
| `state` | `{ call_id, state, reason?, sdp? }` | Server call.state notification |
| `localStream` | `MediaStream \| null` | After getUserMedia / on cleanup |
| `remoteStream` | `MediaStream \| null` | When remote track received / on cleanup |
| `mediaState` | `RTCIceConnectionState` | ICE connection state change |
| `mute` | `{ muted: boolean }` | Local mute/unmute |

## Adding New Call Features

When adding a new call feature (e.g., video toggle, recording):
1. Add method to `Call.ts` with proper active/client guards
2. If server interaction needed:
   - Add enum to `EMessageNotification`
   - Add `sendXxx()` method to `FiretellClient`
   - Add notification handler if server pushes updates
3. Add event to `ECallEventName` if needed
4. Update `README.md` API reference
5. Update `index.ts` exports if new public types
