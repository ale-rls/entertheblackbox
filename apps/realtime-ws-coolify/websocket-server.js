const uWS = require("uWebSockets.js");

/**
 * Room-scoped cursor relay, packaged to match the proven Coolify deployment
 * layout of manegame/uwebsocket-server (flat dir, plain JS, npm ci). Logic
 * ported from apps/realtime-ws/src/server.ts -- see that package's README
 * for the relationship to the main protocol / phase engine.
 *
 * Each installation's phones/display connect with `?room=<installationId>:<roomId>`
 * and only ever see cursor traffic from their own room.
 */

const PORT = Number(process.env.WS_PORT || 9001);
const MAX_PAYLOAD_LENGTH = 4 * 1024;
const IDLE_TIMEOUT = 32;
const PING_INTERVAL_MS = 30000;
const MAX_BACKPRESSURE = 1024;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 50;
const MAX_ROOM_ID_LENGTH = 200;
const MAX_CLIENT_ID_LENGTH = 200;

const rooms = new Map();
const rateLimits = new Map();

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function checkRateLimit(id, now) {
  const limit = rateLimits.get(id) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
  if (now > limit.resetTime) {
    rateLimits.set(id, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (limit.count >= RATE_LIMIT_MAX_MESSAGES) return false;
  limit.count += 1;
  return true;
}

function roomMembers(room) {
  let members = rooms.get(room);
  if (!members) {
    members = new Map();
    rooms.set(room, members);
  }
  return members;
}

function broadcastToRoom(room, message, exceptId) {
  const members = rooms.get(room);
  if (!members) return;
  const encoded = JSON.stringify(message);
  for (const [id, socket] of members) {
    if (id === exceptId) continue;
    socket.send(encoded);
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, limit] of rateLimits) {
    if (now > limit.resetTime + RATE_LIMIT_WINDOW_MS) rateLimits.delete(id);
  }
}, 60000).unref();

const app = uWS.App()
  .ws("/*", {
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: MAX_PAYLOAD_LENGTH,
    idleTimeout: IDLE_TIMEOUT,
    maxBackpressure: MAX_BACKPRESSURE,

    upgrade: (res, req, context) => {
      const room = (req.getQuery("room") || "").slice(0, MAX_ROOM_ID_LENGTH);
      const clientId = (req.getQuery("clientId") || randomId()).slice(0, MAX_CLIENT_ID_LENGTH);
      const color = (req.getQuery("color") || "#ffffff").slice(0, 20);
      const secWebSocketKey = req.getHeader("sec-websocket-key");
      const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
      const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");
      if (!room) {
        res.writeStatus("400 Bad Request").end("missing room");
        return;
      }
      res.upgrade(
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

    message: (ws, message) => {
      const data = ws.getUserData();
      if (!checkRateLimit(data.id, Date.now())) return;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.from(message).toString("utf8"));
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null || parsed.t !== "cursor_update") return;
      const { x, y } = parsed;
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
    res.writeStatus("200 OK").writeHeader("Content-Type", "application/json").end(JSON.stringify({
      status: "ok",
      rooms: rooms.size,
      activeConnections: totalConnections,
      uptime: process.uptime(),
      timestamp: Date.now(),
    }));
  })

  .get("/stats", (res) => {
    const byRoom = {};
    for (const [room, members] of rooms) byRoom[room] = members.size;
    res.writeStatus("200 OK").writeHeader("Content-Type", "application/json").end(JSON.stringify({
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

function gracefulShutdown(signal) {
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

module.exports = { app };
