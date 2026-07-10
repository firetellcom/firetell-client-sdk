---
name: sdk-testing-and-build
description: >
  Build, test, and release workflow for firetell-client-sdk.
  Trigger on: build errors, test creation, CI/CD setup, publishing,
  version bumping, or troubleshooting build issues.
---

# Build, Test & Release

## Build

### Tool: tsup
- Config: `tsup.config.ts`
- Entry: `src/index.ts`
- Output formats: CJS (`dist/index.js`), ESM (`dist/index.mjs`), IIFE (`dist/index.global.js`)
- Global name (IIFE): `Firetell`
- Type definitions: `dist/index.d.ts`, `dist/index.d.mts`
- Source maps: enabled
- Clean output: yes

### Build Commands
```bash
npm run build        # Build all formats + types
```

### TypeScript Config
- Target: ESNext
- Module: CommonJS
- `noImplicitAny: true` — strict typing enforced
- Root: `./src`, Output: `./dist`

### ESLint Config
- Framework: flat config (`eslint.config.mts`)
- Plugins: `@eslint/js` + `typescript-eslint`
- Globals: browser

## Testing

### Current State
No tests exist yet. When creating tests:

### Recommended Setup
```bash
npm install -D vitest jsdom
```

Add to `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Add `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

### Priority Test Areas
1. **SimpleEventEmitter** — on, once, off, emit, offAll
2. **JWT parsing** — valid tokens, invalid format, expired, missing fields
3. **JSON-RPC message handling** — success response, error response, notification routing
4. **Call state machine** — state transitions, terminal states cleanup
5. **Reconnection logic** — retry count, backoff timing, max retries
6. **Domain validation** — with/without protocol, trailing slash, invalid

### Mocking Strategy
- **WebSocket**: Mock `WebSocket` class for signaling tests
- **RTCPeerConnection**: Mock for Call tests (browser API)
- **fetch**: Mock for metadata/login endpoint tests
- **localStorage**: jsdom provides this automatically

## Publishing

### Registry: npm (scoped @firetell)
```bash
npm publish --access public
```

### Pre-publish
- `prepublishOnly` script runs `npm run build` automatically
- Only `dist/` is published (configured in `package.json` `files` field)

### Version Bump
```bash
npm version patch|minor|major
```

Remember to also update `SDK_VERSION` constant in `FiretellClient.ts` to match `package.json` version.

## Common Build Issues

### "Cannot find name 'RTCPeerConnection'"
Ensure `tsconfig.json` doesn't have `lib` set, or add `"lib": ["ESNext", "DOM"]`.

### "Cannot find name 'Buffer'"
The SDK uses `Buffer` for Node.js JWT parsing. `@types/node` is in devDependencies. This is handled at runtime via `typeof window === "undefined"` check.
