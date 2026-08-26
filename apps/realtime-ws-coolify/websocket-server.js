const uWS = require("uWebSockets.js");

/**
 * Room-scoped cursor relay, packaged to match the proven Coolify deployment
 * layout of manegame/uwebsocket-server (flat dir, plain JS, npm ci).
 *
 * Each installation's phones/display connect with `?room=<installationId>:<roomId>`
 * and only ever see cursor traffic from their own room. Connections also
 * carry `?role=phone|display` (default `phone`): phones only ever publish
 * position, so cursor traffic is broadcast to display sockets only, and
 * position updates are coalesced into a periodic `cursor_batch` rather than
 * relayed one-for-one. Without this, a room-wide broadcast of every phone's
 * update to every other phone is O(n^2) in room size and is what actually
 * falls over with a few hundred phones in a room -- not the display's
 * canvas rendering, which stays cheap regardless of cursor count.
 */

const PORT = Number(process.env.WS_PORT || 9001);
const MAX_PAYLOAD_LENGTH = 4 * 1024;
const IDLE_TIMEOUT = 32;
const PING_INTERVAL_MS = 30000;
const MAX_BACKPRESSURE = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 50;
const MAX_ROOM_ID_LENGTH = 200;
const MAX_CLIENT_ID_LENGTH = 200;
const FLUSH_INTERVAL_MS = 75;

const rooms = new Map();
const pendingByRoom = new Map();
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

function roomPending(room) {
  let pending = pendingByRoom.get(room);
  if (!pending) {
    pending = new Map();
    pendingByRoom.set(room, pending);
  }
  return pending;
}

function roomDisplays(room) {
  const members = rooms.get(room);
  if (!members) return [];
  const displays = [];
  for (const socket of members.values()) {
    if (socket.getUserData().role === "display") displays.push(socket);
  }
  return displays;
}

function broadcastToDisplays(room, message, exceptId) {
  const displays = roomDisplays(room);
  if (displays.length === 0) return;
  const encoded = JSON.stringify(message);
  for (const socket of displays) {
    if (socket.getUserData().id === exceptId) continue;
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

// Coalesce phone position updates per room and flush them to that room's
// display socket(s) as one `cursor_batch` message, instead of relaying each
// `cursor_update` the instant it arrives. Caps outbound message volume at a
// fixed rate regardless of how many phones are in the room.
setInterval(() => {
  for (const [room, pending] of pendingByRoom) {
    if (pending.size === 0) continue;
    const displays = roomDisplays(room);
    if (displays.length > 0) {
      const encoded = JSON.stringify({ t: "cursor_batch", cursors: [...pending.values()] });
      for (const socket of displays) socket.send(encoded);
    }
    pending.clear();
  }
}, FLUSH_INTERVAL_MS).unref();

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
      const role = req.getQuery("role") === "display" ? "display" : "phone";
      const secWebSocketKey = req.getHeader("sec-websocket-key");
      const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
      const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");
      if (!room) {
        res.writeStatus("400 Bad Request").end("missing room");
        return;
      }
      res.upgrade(
        { id: randomId(), room, clientId, color, role, isAlive: true, x: null, y: null },
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context,
      );
    },

    open: (ws) => {
      const data = ws.getUserData();
      roomMembers(data.room).set(data.id, ws);
      if (data.role === "display") {
        const snapshot = [...roomMembers(data.room).values()]
          .filter((socket) => socket !== ws)
          .map((socket) => {
            const other = socket.getUserData();
            return { clientId: other.clientId, color: other.color, x: other.x, y: other.y };
          })
          .filter((cursor) => cursor.x !== null && cursor.y !== null);
        ws.send(JSON.stringify({ t: "cursor_snapshot", cursors: snapshot }));
      }
      broadcastToDisplays(data.room, { t: "cursor_join", clientId: data.clientId, color: data.color }, data.id);
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
      roomPending(data.room).set(data.clientId, { clientId: data.clientId, color: data.color, x: data.x, y: data.y });
    },

    pong: (ws) => {
      ws.getUserData().isAlive = true;
    },

    close: (ws) => {
      const data = ws.getUserData();
      roomMembers(data.room).delete(data.id);
      const pending = pendingByRoom.get(data.room);
      if (pending) pending.delete(data.clientId);
      if (roomMembers(data.room).size === 0) {
        rooms.delete(data.room);
        pendingByRoom.delete(data.room);
      }
      rateLimits.delete(data.id);
      broadcastToDisplays(data.room, { t: "cursor_leave", clientId: data.clientId });
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
  pendingByRoom.clear();
  rateLimits.clear();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

module.exports = { app };
