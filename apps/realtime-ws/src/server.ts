import uWS from "uWebSockets.js";

/**
 * Room-scoped cursor relay, adapted from the standalone
 * ai-democracy-websocket-server deployment (which broadcasts to literally
 * every connected client with no concept of rooms). Each installation's
 * phones/display connect with `?room=<installationId>:<roomId>` and only
 * ever see cursor traffic from their own room.
 *
 * This is a low-latency side channel for cursor *position*, not the
 * authoritative input path: votes are still recorded over the main
 * @smartphonecracy/server /ws connection (packages/protocol's `input`
 * message), which the phase engine's VoteEngine consumes directly. This
 * relay exists purely so the display can render cursor movement without
 * waiting on that connection's batching.
 */

const PORT = Number(process.env.WS_PORT ?? 9001);
const MAX_PAYLOAD_LENGTH = 4 * 1024;
const IDLE_TIMEOUT = 32;
const PING_INTERVAL_MS = 30_000;
const MAX_BACKPRESSURE = 1024;
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MESSAGES = 50;
const MAX_ROOM_ID_LENGTH = 200;
const MAX_CLIENT_ID_LENGTH = 200;

type UserData = {
  id: string;
  room: string;
  clientId: string;
  color: string;
  isAlive: boolean;
  x: number | null;
  y: number | null;
};

type Socket = uWS.WebSocket<UserData>;

const rooms = new Map<string, Map<string, Socket>>();
const rateLimits = new Map<string, { count: number; resetTime: number }>();

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function checkRateLimit(id: string, now: number): boolean {
  const limit = rateLimits.get(id) ?? { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
  if (now > limit.resetTime) {
    rateLimits.set(id, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (limit.count >= RATE_LIMIT_MAX_MESSAGES) return false;
  limit.count += 1;
  return true;
}

function roomMembers(room: string): Map<string, Socket> {
  let members = rooms.get(room);
  if (!members) {
    members = new Map();
    rooms.set(room, members);
  }
  return members;
}

function broadcastToRoom(room: string, message: unknown, exceptId?: string): void {
  const members = rooms.get(room);
  if (!members) return;
  const encoded = JSON.stringify(message);
  for (const [id, socket] of members) {
    if (id === exceptId) continue;
    socket.send(encoded);
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, limit] of rateLimits) {
    if (now > limit.resetTime + RATE_LIMIT_WINDOW_MS) rateLimits.delete(id);
  }
}, 60_000).unref();

const app = uWS.App()
  .ws<UserData>("/*", {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: MAX_PAYLOAD_LENGTH,
    idleTimeout: IDLE_TIMEOUT,
    maxBackpressure: MAX_BACKPRESSURE,

    upgrade: (res, req, context) => {
      const room = (req.getQuery("room") ?? "").slice(0, MAX_ROOM_ID_LENGTH);
      const clientId = (req.getQuery("clientId") ?? randomId()).slice(0, MAX_CLIENT_ID_LENGTH);
      const color = (req.getQuery("color") ?? "#ffffff").slice(0, 20);
      const secWebSocketKey = req.getHeader("sec-websocket-key");
      const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
      const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");
      if (!room) {
        res.writeStatus("400 Bad Request").end("missing room");
        return;
      }
      res.upgrade<UserData>(
        { id: randomId(), room, clientId, color, isAlive: true, x: null, y: null },
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context,
      );
    },

    open: (ws) => {
      const data = ws.getUserData();
      roomMembers(data.room).set(data.id, ws);
      const snapshot = [...roomMembers(data.room).values()]
        .filter((socket) => socket !== ws)
        .map((socket) => {
          const other = socket.getUserData();
          return { clientId: other.clientId, color: other.color, x: other.x, y: other.y };
        })
        .filter((cursor) => cursor.x !== null && cursor.y !== null);
      ws.send(JSON.stringify({ t: "cursor_snapshot", cursors: snapshot }));
      broadcastToRoom(data.room, { t: "cursor_join", clientId: data.clientId, color: data.color }, data.id);
    },

    message: (ws, message, _isBinary) => {
      const data = ws.getUserData();
      if (!checkRateLimit(data.id, Date.now())) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(message).toString("utf8"));
      } catch {
        return;
      }
      if (
        typeof parsed !== "object" || parsed === null ||
        (parsed as { t?: unknown }).t !== "cursor_update"
      ) return;
      const { x, y } = parsed as { x?: unknown; y?: unknown };
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
      data.x = clamp01(x);
      data.y = clamp01(y);
      broadcastToRoom(data.room, {
        t: "cursor_update",
        clientId: data.clientId,
        color: data.color,
        x: data.x,
        y: data.y,
      }, data.id);
    },

    pong: (ws) => {
      ws.getUserData().isAlive = true;
    },

    close: (ws) => {
      const data = ws.getUserData();
      roomMembers(data.room).delete(data.id);
      if (roomMembers(data.room).size === 0) rooms.delete(data.room);
      rateLimits.delete(data.id);
      broadcastToRoom(data.room, { t: "cursor_leave", clientId: data.clientId });
    },
  })

  .get("/health", (res) => {
    let totalConnections = 0;
    for (const members of rooms.values()) totalConnections += members.size;
    res.writeHeader("Content-Type", "application/json").end(JSON.stringify({
      status: "ok",
      rooms: rooms.size,
      activeConnections: totalConnections,
      uptime: process.uptime(),
      timestamp: Date.now(),
    }));
  })

  .get("/stats", (res) => {
    const byRoom: Record<string, number> = {};
    for (const [room, members] of rooms) byRoom[room] = members.size;
    res.writeHeader("Content-Type", "application/json").end(JSON.stringify({
      rooms: byRoom,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      timestamp: Date.now(),
    }));
  })

  .listen(PORT, (token) => {
    if (!token) {
      console.error(`[SERVER] Failed to listen on port ${PORT}`);
      process.exit(1);
    }
    console.log(`[SERVER] Room-scoped cursor relay listening on port ${PORT}`);
  });

setInterval(() => {
  for (const members of rooms.values()) {
    for (const [id, socket] of members) {
      const data = socket.getUserData();
      if (!data.isAlive) {
        members.delete(id);
        rateLimits.delete(id);
        socket.close();
        continue;
      }
      data.isAlive = false;
      socket.ping();
    }
  }
}, PING_INTERVAL_MS).unref();

function gracefulShutdown(signal: string): void {
  console.log(`[SHUTDOWN] ${signal} received, closing connections...`);
  for (const members of rooms.values()) {
    for (const socket of members.values()) socket.close();
  }
  rooms.clear();
  rateLimits.clear();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { app };
