# @smartphonecracy/realtime-ws

Room-scoped uWebSockets.js relay, adapted from the standalone
`ai-democracy-websocket-server` deployment (currently live at
`aidemocracy-websockets.enabler.space:9001`) for this project's cursor
broadcast. The original server has no concept of rooms — every message is
broadcast to literally every connected client. This adaptation scopes every
broadcast to a `room` (an `installationId:roomId` string), so multiple
installations can share one deployment without their cursors leaking into
each other.

## Usage

```bash
pnpm --filter @smartphonecracy/realtime-ws dev    # http://localhost:9001
```

Clients connect with `ws://host:9001/?room=<id>&clientId=<id>&color=<hex>`
and exchange JSON messages:

- Client → server: `{ "t": "cursor_update", "x": 0..1, "y": 0..1 }`
- Server → client on open: `{ "t": "cursor_snapshot", "cursors": [{clientId, color, x, y}] }`
  (every other cursor already in the room with a known position)
- Server → room (except sender): `{ "t": "cursor_join", clientId, color }`,
  `{ "t": "cursor_update", clientId, color, x, y }`, `{ "t": "cursor_leave", clientId }`

`/health` and `/stats` report room/connection counts.

## Relationship to the main protocol

This relay is additive, not a replacement for `packages/protocol`'s `input`
message. Position-question votes are the *same* normalized (x, y) a phone
sends while dragging, and the phase engine's `VoteEngine` only trusts input
recorded over the authoritative `/ws` connection to `@smartphonecracy/server`
— that path is unchanged. This relay is a low-latency side channel purely
for the display's cursor *visualization*, so a phone that also wants
snappier on-screen cursor feedback publishes to both.

**Not yet wired into `apps/phone` / `apps/display`.** Doing so touches the
tested `CursorField` interpolation model and the phase engine's existing
cursor batching (`apps/server/src/cursors/`), and needs an actual browser to
verify the golden path — left as a deliberate follow-up rather than risking
a blind change to that path.

## Deployment

Same shape as the reference deployment: `Dockerfile` here, `WS_PORT` env var
(default 9001). Point Studio/production installations at the same host the
existing `aidemocracy-websockets.enabler.space` deployment already uses, or
run a project-specific instance — this fork only changes room scoping, not
the transport.
