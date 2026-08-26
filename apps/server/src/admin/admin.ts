import type { FastifyInstance, FastifyRequest } from "fastify";
import { InMemoryIpRateLimiter, requestIp } from "../admission/rate-limit.js";
import type { PhaseCheckpoint, PhaseEngine, TransitionResult } from "../engine/phase-engine.js";
import type {
  MovementBatchFlushed,
  MovementRecordingFinalized,
  MovementRecordingStarted,
} from "../movement/index.js";
import type { PublishedShowSummary } from "../readiness.js";
import type { FinalVoteSnapshot } from "../votes/index.js";

export type AdminExport = { json: unknown; csv: string };
export interface AdminDataSource {
  recentErrors(): Promise<readonly unknown[]>;
  exportSession(sessionId: string): Promise<AdminExport | null>;
  audit(entry: { action: string; at: string; detail: unknown }): void;
  recordError?(entry: { message: string; at: string; path: string }): void;
  recordCheckpoint?(checkpoint: PhaseCheckpoint): void;
  recordVoteSnapshot?(snapshot: FinalVoteSnapshot): void;
  recordMovementStarted?(event: MovementRecordingStarted): void;
  recordMovementBatch?(event: MovementBatchFlushed): void;
  recordMovementFinalized?(event: MovementRecordingFinalized): void;
}

export type RegisterAdminOptions = {
  /** Validates a bearer token against the operators auth collection. */
  verifyToken: (token: string) => Promise<boolean>;
  engine: () => PhaseEngine | null;
  ready: boolean;
  startedAt: number;
  data?: AdminDataSource;
  trustProxy?: boolean;
  rateLimitPolicy?: AdminRateLimitPolicy;
  rateLimiters?: AdminRateLimiters;
  now?: () => number;
  showConfig?: {
    /** The showId this running process actually booted with, or null if no scenario is ready. */
    activeShowId: string | null;
    list: () => Promise<PublishedShowSummary[]>;
    /** The operator-saved pending selection, if any -- takes effect on next restart. */
    readPending: () => Promise<string | null>;
    write: (showId: string) => Promise<void>;
    publish: (record: { showId: string; name: string; scenario: unknown; mediaManifest: unknown }) => Promise<PublishedShowSummary>;
  };
};

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export type AdminRateLimitPolicy = {
  maxAuthenticatedRequests: number;
  maxAuthenticationFailures: number;
  windowMs: number;
};

export type AdminRateLimiters = {
  authenticated: InMemoryIpRateLimiter;
  authenticationFailures: InMemoryIpRateLimiter;
};

export const DEFAULT_ADMIN_RATE_LIMIT_POLICY: AdminRateLimitPolicy = {
  // One dashboard makes about 60 requests/minute while polling every two seconds.
  maxAuthenticatedRequests: 600,
  maxAuthenticationFailures: 30,
  windowMs: 60_000,
};

async function authorized(request: FastifyRequest, verifyToken: (token: string) => Promise<boolean>): Promise<boolean> {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  return verifyToken(value.slice(7));
}

export function registerAdminRoutes(app: FastifyInstance, options: RegisterAdminOptions): void {
  const policy = options.rateLimitPolicy ?? DEFAULT_ADMIN_RATE_LIMIT_POLICY;
  const rateLimiters = options.rateLimiters ?? {
    authenticated: new InMemoryIpRateLimiter({
      maxAttempts: policy.maxAuthenticatedRequests,
      windowMs: policy.windowMs,
    }),
    authenticationFailures: new InMemoryIpRateLimiter({
      maxAttempts: policy.maxAuthenticationFailures,
      windowMs: policy.windowMs,
    }),
  };
  const now = options.now ?? (() => Date.now());

  app.register(async (admin) => {
    admin.addHook("onRequest", async (request, reply) => {
      const isAuthorized = await authorized(request, options.verifyToken);
      const rate = (isAuthorized ? rateLimiters.authenticated : rateLimiters.authenticationFailures)
        .consume(requestIp(request.raw, options.trustProxy ?? false), now());
      if (!rate.allowed) {
        if (rate.retryAfterMs !== undefined) {
          reply.header("retry-after", Math.ceil(rate.retryAfterMs / 1_000));
        }
        return reply.code(429).send({
          error: "rate_limited",
          ...(rate.retryAfterMs === undefined ? {} : { retryAfterMs: rate.retryAfterMs }),
        });
      }
      if (!isAuthorized) return reply.code(401).send({ error: "unauthorized" });
    });

    admin.get("/status", async () => {
      const engine = options.engine();
      return {
        healthy: true,
        ready: options.ready,
        uptimeMs: Date.now() - options.startedAt,
        displayConnected: engine?.isDisplayConnected ?? false,
        displayHeartbeatAgeMs: engine?.displayHeartbeatAgeMs ?? null,
        displayPlaybackIssue: engine?.currentDisplayPlaybackIssue ?? null,
        connectedParticipants: engine?.connectedParticipantCount ?? 0,
        sessionId: engine?.currentSessionId ?? null,
        lifecycle: engine?.lifecycleState ?? null,
        phaseId: engine?.currentPhaseId ?? null,
        phaseEpoch: engine?.currentPhaseEpoch ?? null,
      };
    });
    admin.get("/errors", async () => ({ errors: await options.data?.recentErrors() ?? [] }));
    admin.get("/shows", async (_request, reply) => {
      if (!options.showConfig) return reply.code(503).send({ error: "show_config_unavailable" });
      return {
        active: options.showConfig.activeShowId,
        pending: await options.showConfig.readPending(),
        shows: await options.showConfig.list(),
      };
    });
    admin.post<{ Body: { showId?: unknown } }>("/shows", async (request, reply) => {
      if (!options.showConfig) return reply.code(503).send({ error: "show_config_unavailable" });
      const { showId } = request.body ?? {};
      if (typeof showId !== "string" || showId === "") {
        return reply.code(400).send({ error: "invalid_show_id" });
      }
      const shows = await options.showConfig.list();
      if (!shows.some((show) => show.showId === showId)) {
        return reply.code(400).send({ error: "unknown_show_id" });
      }
      await options.showConfig.write(showId);
      options.data?.audit({ action: "set-active-show", at: new Date().toISOString(), detail: { showId } });
      return { ok: true, pending: showId };
    });
    admin.post<{ Body: { showId?: unknown; name?: unknown; scenario?: unknown; mediaManifest?: unknown } }>("/publish", async (request, reply) => {
      if (!options.showConfig) return reply.code(503).send({ error: "show_config_unavailable" });
      const { showId, name, scenario, mediaManifest } = request.body ?? {};
      if (
        typeof showId !== "string" || !INSTALLATION_ID_PATTERN.test(showId)
        || typeof name !== "string" || name.trim() === ""
        || typeof scenario !== "object" || scenario === null
        || typeof mediaManifest !== "object" || mediaManifest === null
      ) {
        return reply.code(400).send({ error: "invalid_publish_request" });
      }
      const published = await options.showConfig.publish({ showId, name, scenario, mediaManifest });
      options.data?.audit({ action: "publish-show", at: new Date().toISOString(), detail: { showId, name } });
      return { ok: true, show: published };
    });
    admin.get<{ Params: { sessionId: string }; Querystring: { format?: string } }>("/sessions/:sessionId/export", async (request, reply) => {
      const result = await options.data?.exportSession(request.params.sessionId);
      if (!result) return reply.code(404).send({ error: "session_not_found" });
      if (request.query.format === "csv") return reply.type("text/csv; charset=utf-8").send(result.csv);
      return result.json;
    });
    for (const action of ["start", "idle", "skip", "restart"] as const) {
      admin.post(`/${action}`, async (_request, reply) => {
        const engine = options.engine();
        const result: TransitionResult = engine === null
          ? { ok: false, reason: "wrong-phase" }
          : action === "start" ? engine.adminStart()
            : action === "idle" ? engine.adminIdle()
              : action === "skip" ? engine.adminSkip()
                : engine.adminRestart();
        options.data?.audit({ action, at: new Date().toISOString(), detail: result });
        return result.ok ? result : reply.code(409).send(result);
      });
    }
  }, { prefix: "/api/admin" });
}
