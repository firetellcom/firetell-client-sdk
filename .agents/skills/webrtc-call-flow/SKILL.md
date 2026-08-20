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
Outbound:  INITIATED → REST POST /calls (returns call_token) → WS connect → call.offer → ANSWERED → ACTIVE → ENDED/ERROR
Inbound:   SSE call.ring event → accept() → WS connect → call.offer (server) → call.answer → ANSWERED → ACTIVE → ENDED/ERROR
Hold:      ACTIVE → ONHOLD → ACTIVE
Cancel:    any → CANCEL
```

## Outbound Call Flow

```
1. new Call(client, options)
2. call.start()
   ├─ setupWebrtcMedia() → getUserMedia → addTracks to PeerConnection
   ├─ createOffer() → setLocalDescription()
   ├─ getSDPFull() → wait for all ICE candidates
   └─ client.makeCall(call, sdp)
       ├─ REST POST /api/v1/call-center/calls → returns { call_id, call_token, ws_url }
       ├─ Open native WebSocket to ws_url
       ├─ Send session.connect with call_token within 3s
       └─ Send call.offer with { call_id, sdp }
3. Server WS event: call.answered (with remote SDP)
4. Call.setRemoteDescription(sdp) → media flows
```

## Inbound Call Flow

```
1. SSE Event: call.ring { call_id, from, number, is_transfer } → Notification to UI
2. Consumer calls call.accept()
   ├─ Connects to per-call WebSocket with call_token
   ├─ Receives Server WS event: call.offer { call_id, from, sdp }
   ├─ setupWebrtcMedia() → getUserMedia → addTracks
   ├─ setRemoteDescription(offer SDP)
   ├─ createAnswer() → setLocalDescription()
   ├─ getSDPFull() → wait for all ICE candidates
   └─ Sends WS event: call.answer { call_id, sdp }
```

## Full ICE Gathering (getSDPFull)

Firetell's Media Server requires Full ICE. The `getSDPFull()` method:

1. Checks if `iceGatheringState === "complete"` — if so, return immediately
2. Otherwise, listens for `onicecandidate` events
3. When `event.candidate === null`, all candidates gathered → resolve with localDescription
4. 10s timeout → reject with error

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
    ? client.iceServers // From workspace metadata
    : [{ urls: "stun:stun.l.google.com:19302" }], // Fallback
});
```

ICE servers are fetched from `GET /api/v1` during initialization.

## Call Cleanup (destroy)

```
1. If active → best-effort sendHangup (catch errors silently)
2. Set active = false, client = null
3. cleanupPeerConnection:
   ├─ Remove all PeerConnection event handlers
   ├─ Close PeerConnection (WebSocket per-call closes)
   ├─ Stop all local media tracks
   └─ Emit null for localStream/remoteStream
4. offAll() → remove all event listeners
```
