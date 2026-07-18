import Fastify, { type FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { AdmissionController } from "./admission/index.js";
import { registerAdminRoutes, type AdminDataSource } from "./admin/index.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { PhaseEngine } from "./engine/phase-engine.js";
import { loadScenarioReadiness, type ScenarioReadiness } from "./readiness.js";
import { registerBundleRoutes, registerMediaRoutes } from "./static.js";

export const WEBSOCKET_MAX_PAYLOAD_BYTES = 16 * 1024;
export const DEFAULT_MAX_WEBSOCKET_CONNECTIONS = 64;
export const DEFAULT_WEBSOCKET_KEEPALIVE_INTERVAL_MS = 30_000;

type HeartbeatWebSocket = WebSocket & { isAlive: boolean };

export type BuildServerOptions = {
  config?: ServerConfig;
  readiness?: ScenarioReadiness;
  onWebSocketConnection?: (socket: WebSocket) => void;
  admission?: AdmissionController;
  adminData?: AdminDataSource;
  maxWebSocketConnections?: number;
  webSocketKeepAliveIntervalMs?: number;
};

export type ServerRuntime = {
  app: FastifyInstance;
  config: ServerConfig;
  readiness: ScenarioReadiness;
  webSockets: WebSocketServer;
  admission: AdmissionController;
  engine: PhaseEngine | null;
  startedAt: number;
};

export async function buildServer(options: BuildServerOptions = {}): Promise<ServerRuntime> {
  const config = options.config ?? loadConfig();
  const readiness = options.readiness ?? (await loadScenarioReadiness(config));
  const startedAt = Date.now();
  const app = Fastify({ logger: config.nodeEnv !== "test" });
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES,
  });
  const maxWebSocketConnections = options.maxWebSocketConnections
    ?? DEFAULT_MAX_WEBSOCKET_CONNECTIONS;
  if (!Number.isSafeInteger(maxWebSocketConnections) || maxWebSocketConnections < 1) {
    throw new Error("maxWebSocketConnections must be a positive integer");
  }
  const webSocketKeepAliveIntervalMs = options.webSocketKeepAliveIntervalMs
    ?? DEFAULT_WEBSOCKET_KEEPALIVE_INTERVAL_MS;
  if (!Number.isSafeInteger(webSocketKeepAliveIntervalMs) || webSocketKeepAliveIntervalMs < 1) {
    throw new Error("webSocketKeepAliveIntervalMs must be a positive integer");
  }
  const publicVideoPhases = readiness.ready
    ? Object.fromEntries(
        readiness.scenario.phases
          .filter((phase) => phase.kind === "video")
          .map((phase) => [phase.id, phase.src]),
      )
    : null;
  const adminData = options.adminData;
  let engine: PhaseEngine | null = null;
  const admission = options.admission ?? new AdmissionController({
    installationId: config.installationId,
    roomId: config.roomId,
    secret: config.joinGrantSecret,
    trustProxy: config.trustProxy,
    buildVersion: config.buildVersion,
    isNewParticipantAllowed: () => config.allowLateJoin || engine?.lifecycleState !== "active",
    onClientMessage: (message, socket, request) => engine?.handleClientMessage(message, socket, request),
    onParticipantJoin: (participant, socket) => engine?.participantJoined(socket, participant),
    onSocketClosed: (socket) => engine?.socketClosed(socket),
    onMessageError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      app.log.error({ error }, "websocket client message handling failed");
      adminData?.recordError?.({ message, at: new Date().toISOString(), path: "/ws" });
    },
  });
  if (readiness.ready) {
    engine = new PhaseEngine({
      scenario: readiness.scenario,
      registry: admission.registry,
      installationId: config.installationId,
      roomId: config.roomId,
      displayToken: config.displayToken,
      participantLeaseTtlMs: admission.participantLeaseTtlMs,
      qr: {
        phoneJoinBaseUrl: config.phoneJoinBaseUrl,
        issueGrant: (now) => admission.issueJoinGrant(now),
        allowLateJoin: config.allowLateJoin,
      },
      onSessionEnded: ({ endedAt }) => admission.endParticipantSession(endedAt),
    });
    engine.start();
  }

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_request, reply) => {
    if (!readiness.ready) {
      return reply.code(503).send({ ok: false, errors: readiness.errors });
    }
    return { ok: true, scenarioVersion: readiness.scenario.version };
  });
  app.get("/api/status", async () => ({
    ok: true,
    ready: readiness.ready,
    buildVersion: config.buildVersion,
    installationId: config.installationId,
    roomId: config.roomId,
    scenarioVersion: readiness.ready ? readiness.scenario.version : null,
    scenarioWarnings: readiness.warnings,
    webSocketClients: webSockets.clients.size,
    startedAt,
    uptimeMs: Date.now() - startedAt,
  }));
  app.get("/api/phases", async (_request, reply) => {
    if (!readiness.ready) {
      return reply.code(503).send({ error: "scenario_unavailable" });
    }

    return publicVideoPhases;
  });
  app.addHook("onError", async (request, _reply, error) => {
    adminData?.recordError?.({ message: error.message, at: new Date().toISOString(), path: request.url });
  });
  registerAdminRoutes(app, {
    token: config.adminToken,
    engine: () => engine,
    ready: readiness.ready,
    startedAt,
    trustProxy: config.trustProxy,
    rateLimitPolicy: config.adminRateLimit,
    ...(adminData === undefined ? {} : { data: adminData }),
  });

  registerMediaRoutes(app, config.mediaManifestPath, config.mediaDir);
  registerBundleRoutes(app, config.bundleDirs);

  app.server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (webSockets.clients.size >= maxWebSocketConnections) {
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit("connection", webSocket, request);
    });
  });
  webSockets.on("connection", (socket, request) => {
    const heartbeatSocket = socket as HeartbeatWebSocket;
    heartbeatSocket.isAlive = true;
    heartbeatSocket.on("pong", () => {
      heartbeatSocket.isAlive = true;
    });
    admission.handleConnection(socket, request as IncomingMessage);
    options.onWebSocketConnection?.(socket);
  });

  const webSocketKeepAliveInterval = setInterval(() => {
    for (const socket of webSockets.clients) {
      const heartbeatSocket = socket as HeartbeatWebSocket;
      if (heartbeatSocket.isAlive === false) {
        heartbeatSocket.terminate();
        continue;
      }
      heartbeatSocket.isAlive = false;
      if (heartbeatSocket.readyState === WebSocket.OPEN) heartbeatSocket.ping();
    }
  }, webSocketKeepAliveIntervalMs);
  webSocketKeepAliveInterval.unref();

  // Upgraded sockets are not managed by Fastify's HTTP connection tracker.
  // Close them before Fastify waits for the underlying server to drain.
  app.addHook("preClose", async () => {
    clearInterval(webSocketKeepAliveInterval);
    engine?.stop();
    for (const socket of webSockets.clients) socket.terminate();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
  });

  return { app, config, readiness, webSockets, admission, engine, startedAt };
}
