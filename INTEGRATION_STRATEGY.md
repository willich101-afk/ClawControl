# OpenClaw API Integration Strategy

## 1. Endpoint Discovery
The OpenClaw Gateway operates as a WebSocket server.
- **Default Endpoint:** `ws://localhost:18789` (Local)
- **Production Endpoint:** `wss://<hostname>`
- **Discovery Mechanism:** Manual configuration via UI Settings.

## 2. Protocol Overview
The client communicates using a **custom frame-based protocol (v3)** over WebSocket. All frames are JSON objects with a `type` field indicating the frame kind.

### Frame Types

**Request Frame (`req`)** — sent by the client:
```json
{
  "type": "req",
  "id": "1",
  "method": "sessions.list",
  "params": { "limit": 50 }
}
```

**Response Frame (`res`)** — sent by the server:
```json
{
  "type": "res",
  "id": "1",
  "ok": true,
  "payload": { ... }
}
```

Error responses set `ok: false` and include an `error` object:
```json
{
  "type": "res",
  "id": "1",
  "ok": false,
  "error": { "code": "AUTH_FAILED", "message": "Invalid token" }
}
```

**Event Frame (`event`)** — pushed by the server:
```json
{
  "type": "event",
  "event": "chat",
  "payload": { ... }
}
```

## 3. Authentication
Authentication uses a challenge/handshake flow immediately after the WebSocket connection opens.

**Flow:**
1. **Connect** to the WebSocket URL.
2. **Receive** a `connect.challenge` event from the server (may include a `nonce`).
3. **Send** a `connect` request with protocol version, client info, and credentials.

```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "role": "operator",
    "client": {
      "id": "gateway-client",
      "displayName": "ClawControl",
      "version": "1.0.0",
      "platform": "web",
      "mode": "backend"
    },
    "auth": { "token": "YOUR_GATEWAY_TOKEN" }
  }
}
```

The `auth` field supports two modes:
- **Token auth:** `{ "token": "..." }`
- **Password auth:** `{ "password": "..." }`

4. **Receive** a `res` frame with `payload.type: "hello-ok"` on success.

- **Token Storage:** Persisted in local storage (`clawcontrol-storage`).
- **Token Source:** Found in `~/.config/openclaw/config.json` on the server machine.

## 4. Data Schema Mapping
We map OpenClaw protocol entities to internal TypeScript interfaces.

| OpenClaw Entity | Internal Interface | File |
|-----------------|-------------------|------|
| `session` | `Session` | `src/lib/openclaw-client.ts` |
| `message` | `Message` | `src/lib/openclaw-client.ts` |
| `agent` | `Agent` | `src/lib/openclaw-client.ts` |
| `skill` | `Skill` | `src/lib/openclaw-client.ts` |
| `cronJob` | `CronJob` | `src/lib/openclaw-client.ts` |
| `agentFile` | `AgentFile` | `src/lib/openclaw-client.ts` |

**Key RPC Methods:**
- `sessions.list` — List chat sessions
- `sessions.delete` — Delete a session
- `sessions.patch` — Update session metadata (e.g., label)
- `sessions.spawn` — Spawn a new isolated subagent session
- `chat.send` — Send a message
- `chat.history` — Retrieve message history for a session
- `agents.list` — List available agents
- `agent.identity.get` — Get agent identity (name, emoji, avatar)
- `agents.files.list` / `agents.files.get` / `agents.files.set` — Agent workspace files
- `skills.status` — List skills with status
- `skills.update` — Enable/disable a skill
- `skills.install` — Install a skill
- `cron.list` / `cron.get` / `cron.update` — Cron job management

## 5. Streaming Events
The server pushes real-time events for chat and agent activity.

**`chat` event** — Message streaming:
- `state: "delta"` — Incremental text chunk in `delta` field
- `state: "final"` — Complete message in `message` field

**`agent` event** — Agent activity streaming:
- `stream: "assistant"` — Text output with `data.delta` for incremental content
- `stream: "lifecycle"` — Agent lifecycle; `data.state: "complete"` signals end of stream

**`presence` event** — Agent online/offline status changes.

The client tracks the active stream source (`chat` or `agent`) to prevent duplicate content when both event types fire for the same response.

## 6. Error Handling
The client implements robust error handling for the WebSocket lifecycle:

- **Connection Errors:** `ws.onerror` captures network failures (e.g., Connection Refused, SSL Errors). Certificate errors on `wss://` connections trigger a `certError` event with a URL to accept the cert.
- **Protocol Errors:** Handled via `ok: false` in response frames with structured `error` objects containing `code`, `message`, and optional `details`.
- **Request Timeouts:** Pending requests time out after 30 seconds.
- **Reconnection Logic:** Exponential backoff (1s, 2s, 4s, 8s, ...) up to 5 attempts on `ws.onclose`.

## 7. Rate Limiting
- **Client-Side:** No explicit rate limiting is currently implemented, but the UI prevents rapid-fire submissions. An idempotency key is sent with each `chat.send` to prevent duplicate messages.
- **Server-Side:** OpenClaw Gateway handles request queuing.

## 8. Testing Strategy
- **Unit Tests:** `src/lib/openclaw-client.test.ts` covers the client logic using mocked WebSockets.
- **Integration Test:** Run the app and use the **Connection Settings** modal to verify connectivity against a live server.
