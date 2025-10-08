# Telcheap Client SDK

TypeScript/JavaScript SDK for Telcheap WebRTC Client, supporting audio/video calls via WebRTC with Telcheap system.

## Features

- ✅ **Audio/Video Calls**: Make WebRTC calls with audio and video support
- ✅ **Session Management**: Connect and manage sessions with Telcheap server
- ✅ **Incoming Call Handling**: Receive and handle incoming calls from others
- ✅ **Hold/Unhold**: Pause and resume calls
- ✅ **Transfer**: Transfer calls to other numbers
- ✅ **Event-driven**: Uses EventEmitter for event handling
- ✅ **Auto-reconnect**: Automatically reconnect when connection is lost
- ✅ **TypeScript Support**: Fully written in TypeScript with type definitions

## Installation

```bash
npm install @telcheap/telcheap-client-sdk
```

## Basic Usage

### 1. Initialize Client

```typescript
import { TelcheapClient, Call } from '@telcheap/telcheap-client-sdk';

// Initialize client with JWT token and WebSocket servers
const client = new TelcheapClient(
  'agent-jwt-token',
  'https://api.telcheap.com' // optional, default API URL
);

// Listen to events
client.events.on('session', (session) => {
  console.log('Connected:', session);
});

client.events.on('error', (error) => {
  console.error('Error:', error);
});

client.events.on('call.offer', (call) => {
  console.log('Incoming call from:', call.caller);
});
```

### 2. Make a Call

```typescript
// Create a new call
const call = new Call(client, {
  number: '84978126124',     // Outgoing number
  callee: '1001',           // Destination number
  isVideo: false            // true for video call, false for audio call
});

// Listen to call events
call.on('state', (params) => {
  console.log('Call state:', params.state);
});

call.on('localStream', (stream) => {
  // Display local audio/video
  document.getElementById('localStream').srcObject = stream;
});

call.on('remoteStream', (stream) => {
  // Display remote audio/video
  document.getElementById('remoteStream').srcObject = stream;
});

call.on('mediaState', (state) => {
  console.log('Media state:', state);
});

// Start the call
try {
  await call.start();
  console.log('Call initiated successfully');
} catch (error) {
  console.error('Error making call:', error);
}
```

### 3. Handle Incoming Calls

```typescript
client.events.on('call.offer', (call) => {
  console.log('Incoming call from:', call.caller);
  
  // Listen to call events
  call.on('state', (params) => {
    console.log('Call state:', params.state);
  });
  
  call.on('localStream', (stream) => {
    document.getElementById('localVideo').srcObject = stream;
  });
  
  call.on('remoteStream', (stream) => {
    document.getElementById('remoteVideo').srcObject = stream;
  });
  
  // Accept the call
  call.accept().then(() => {
    console.log('Call accepted');
  }).catch(error => {
    console.error('Error accepting call:', error);
  });
  
  // Or reject the call
  // call.reject();
});
```

### 4. Call Control

```typescript
// Hold the call
await call.onhold();

// Resume the call
await call.unhold();

// Transfer the call
await call.transfer('1002');

// End the call
await call.hangup();
```

## API Reference

### TelcheapClient

#### Constructor
```typescript
new TelcheapClient(jwt: string, baseUrl?: string)
```

#### Events

- `session`: connected to Telcheap server
- `error`: When connect error
- `call.offer`: Incomming call event

### Call

#### Constructor
```typescript
new Call(client: TelcheapClient, options: CallOptions)
```

#### CallOptions Interface
```typescript
interface CallOptions {
  number?: string;      // Outgoing number
  callee: string;       // Destination number (required)
  caller?: string;      // Caller
  isVideo?: boolean;    // Video call
  isTransfer?: boolean; // Transfer call
}
```

#### Methods

- `start()`: Start the call
- `accept()`: Accept incoming call
- `reject()`: Reject incoming call
- `hangup()`: End the call
- `onhold()`: Hold the call
- `unhold()`: Resume the call
- `transfer(callee: string)`: Transfer the call
- `destroy()`: Destroy call and cleanup resources

#### Events

- `state`: Call state changes
- `localStream`: Local video/audio stream
- `remoteStream`: Remote video/audio stream
- `mediaState`: Media connection state (ICE connection state)

### Enums

#### ECallState
```typescript
enum ECallState {
  INITIATED = 'INITIATED',
  TRYING = 'TRYING',
  RINGING = 'RINGING',
  ANSWERED = 'ANSWERED',
  ACTIVE = 'ACTIVE',
  ONHOLD = 'ONHOLD',
  ENDED = 'ENDED',
  ERROR = 'ERROR',
  CANCEL = 'CANCEL'
}
```

#### EClientEventName
```typescript
enum EClientEventName {
  SESSION = 'session',
  ERROR = 'error',
  CALL_OFFER = 'call.offer'
}
```

## Complete Example

See `example/index.html` for a complete example of how to use the SDK in browser.

## System Requirements

- WebRTC supported browser (Chrome, Firefox, Safari, Edge)
- HTTPS or localhost for camera/microphone access
- Stable internet connection

## Notes

- SDK supports only one call at a time
- Valid JWT token is required for connection
- Camera/microphone permissions must be granted to the application

## License

ISC

## Support

Contact: developers@telcheap.com