# Contributing to Firetell Client SDK

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/firetellcom/firetell-client-sdk.git
   cd firetell-client-sdk
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Build**

   ```bash
   npm run build
   ```

4. **Lint**

   ```bash
   npm run lint
   ```

## Project Structure

```
src/
├── index.ts                    # Public API exports
├── firetell-client.ts          # Main client (REST API calls, SSE event listeners, Call factory)
├── call.ts                     # WebRTC call instance (per-call WebSocket signaling, WebRTC media, SDP, call control)
├── simple-event-emitter.ts     # Lightweight typed event emitter
├── enums/                      # Enum definitions
│   ├── index.ts                # Barrel export
│   ├── call-state.enum.ts      # Call lifecycle states
│   ├── call-event-name.enum.ts # Call-level event names
│   ├── client-event-name.enum.ts # Client-level event names
│   ├── storage-key.enum.ts     # localStorage key constants
│   └── message-notification.enum.ts # Native WebSocket per-call event names
└── interfaces/                 # TypeScript interfaces
    ├── index.ts                # Barrel export
    ├── session.interface.ts    # Session shape
    ├── call-options.interface.ts # Call constructor options
    ├── active-call.interface.ts # Reconnect response shape
    ├── jwt-payload.interface.ts # Decoded JWT payload
    └── rpc-message.interface.ts # Event-based WebSocket message shapes
```

## Coding Conventions

### TypeScript

- **No `any`** — use `unknown` and type assertions, or typed interfaces
- **Explicit access modifiers** — `public`/`private` on all class members
- **`readonly`** for immutable public properties

### Naming

- **Files**: `kebab-case` (e.g., `firetell-client.ts`, `call-state.enum.ts`)
- **Classes**: `PascalCase` (e.g., `FiretellClient`, `Call`)
- **Private methods**: `_camelCase` prefix (e.g., `_initWebSocket`)
- **Public methods**: `camelCase` (e.g., `sendHold`, `makeCall`)
- **Enums**: `E` prefix + PascalCase (e.g., `ECallState`)
- **Enum keys**: `UPPER_CASE` (e.g., `MEDIA_STATE`, `DEVICE_ID`)
- **Interfaces**: `I` prefix + PascalCase (e.g., `ISession`, `IJwtPayload`)

### Error Handling

- Throw `new Error(message)` directly — no wrapping in `Promise.reject()`
- Use typed error codes in events: `{ code: number, message: string }`

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes following the coding conventions above
3. Ensure the build passes: `npm run build`
4. Ensure lint passes: `npm run lint`
5. Update documentation if you changed public APIs
6. Submit a pull request with a clear description

## Reporting Issues

Please use [GitHub Issues](https://github.com/firetellcom/firetell-client-sdk/issues) to report bugs or request features.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
