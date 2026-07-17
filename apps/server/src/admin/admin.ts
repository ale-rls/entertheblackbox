import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { InMemoryIpRateLimiter, requestIp } from "../admission/rate-limit.js";
import type { PhaseEngine, TransitionResult } from "../engine/phase-engine.js";

export type AdminExport = { json: unknown; csv: string };
export interface AdminDataSource {
  recentErrors(): Promise<readonly unknown[]>;
  exportSession(sessionId: string): Promise<AdminExport | null>;
  audit(entry: { action: string; at: string; detail: unknown }): void;
  recordError?(entry: { message: string; at: string; path: string }): void;
}

export type RegisterAdminOptions = {
  token: string;
  engine: () => PhaseEngine | null;
  ready: boolean;
  startedAt: number;
  data?: AdminDataSource;
  trustProxy?: boolean;
  rateLimitPolicy?: AdminRateLimitPolicy;
  rateLimiters?: AdminRateLimiters;
  now?: () => number;
};

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

function authorized(request: FastifyRequest, token: string): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
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
      const isAuthorized = authorized(request, options.token);
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
