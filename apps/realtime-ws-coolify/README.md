# @smartphonecracy/realtime-ws-coolify

Room-scoped uWebSockets.js cursor relay, packaged in the flat, plain-JS
layout of [manegame/uwebsocket-server](https://gitlab.com/manegame/uwebsocket-server),
a Coolify deployment this org has already run successfully.

Adapted from the standalone `ai-democracy-websocket-server` deployment
(currently live at `aidemocracy-websockets.enabler.space:9001`), which
broadcasts every message to literally every connected client with no
concept of rooms or roles. This version scopes every broadcast to a `room`
(an `installationId:roomId` string) and to `role` (`phone` publishes
position, `display` renders it), so multiple installations can share one
deployment and a room of a few hundred phones doesn't flood itself.

## Why this exists as a separate package

The proven Coolify deployment expects a flat directory, plain CommonJS
(`require`, no TypeScript/`tsx` at runtime), and `npm ci --only=production`
against a committed `package-lock.json` -- once `uWebSockets.js` is pinned
to a resolved commit in the lockfile, npm fetches it straight from GitHub's
tarball endpoint without needing `git` in the image. `start.sh` bumps
`ulimit -n` before starting, same as the reference.

## Usage

```bash
pnpm --filter @smartphonecracy/realtime-ws-coolify start   # http://localhost:9001
```

Clients connect with
`ws://host:9001/?room=<id>&role=<phone|display>&clientId=<id>&color=<hex>`
(`role` defaults to `phone` if omitted) and exchange JSON messages:

- Phone -> server: `{ "t": "cursor_update", "x": 0..1, "y": 0..1 }`, at
  most ~25 Hz (client-side throttle) and capped server-side at 50
  messages/sec/connection.
- Server -> display, on open: `{ "t": "cursor_snapshot", "cursors": [{clientId, color, x, y}] }`
  (every other cursor already in the room with a known position).
- Server -> display, ~every 75 ms: `{ "t": "cursor_batch", "cursors": [{clientId, color, x, y}, ...] }`
  -- one coalesced message per room containing every cursor that moved
  since the last flush, replacing what would otherwise be one
  `cursor_update` per phone move relayed instantly to every other room
  member. Phone position updates are **never** broadcast to other phones.
- Server -> display: `{ "t": "cursor_join", clientId, color }`,
  `{ "t": "cursor_leave", clientId }`.

`/health` and `/stats` report room/connection counts.

## Why room-only, unbatched broadcast doesn't scale

Broadcasting every `cursor_update` immediately to every other room member
is O(n^2) in room size: at a few hundred phones in one room, each sending
at ~25 Hz, that's tens of thousands of relayed messages per second, most of
them to phones that have no listener for them at all. Restricting cursor
traffic to display sockets only (typically one, maybe a handful) drops that
to O(n), and batching into one `cursor_batch` per room per flush interval
caps the message *rate* to displays regardless of how many phones are
connected -- the tradeoff is up to ~75 ms of added latency on cursor
movement, not felt on a projected display.

## Relationship to the main protocol

This relay is additive, not a replacement for `packages/protocol`'s `input`
message. Position-question votes are the *same* normalized (x, y) a phone
sends while dragging, and the phase engine's `VoteEngine` only trusts input
recorded over the authoritative `/ws` connection to `@smartphonecracy/server`
-- that path is unchanged. This relay is a low-latency side channel purely
for the display's cursor *visualization*.

## Deployment

Same shape as the reference deployment: `Dockerfile` here, `WS_PORT` env var
(default 9001). Point Studio/production installations at the same host the
existing `aidemocracy-websockets.enabler.space` deployment already uses, or
run a project-specific instance.

1. **New Resource -> Application -> Dockerfile build pack**, pointed at
   this repo/branch.
2. **Base Directory**: `apps/realtime-ws-coolify`.
3. **Ports Exposes**: `9001`.
4. **Env vars**: `WS_PORT=9001`, `NODE_ENV=production`.
5. **Health check**: HTTP, path `/health`, port `9001`.
6. Pick a networking mode:
   - Keep Coolify's default Traefik domain and enable SSL on it for
     `wss://your-domain` -- simplest, no firewall changes.
   - Or enable **"Map to Host"** (container port `9001` -> public port
     `9001`) if you hit WS instability through the proxy -- the
     reference guide calls this the safer default; it means opening
     `9001` in the host firewall and terminating TLS yourself if you
     need `wss://`.
