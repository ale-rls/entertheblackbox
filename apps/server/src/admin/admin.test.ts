import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { InMemoryIpRateLimiter } from "../admission/rate-limit.js";
import type { PhaseEngine } from "../engine/phase-engine.js";
import { registerAdminRoutes, type AdminDataSource, type AdminRateLimiters } from "./admin.js";

function setup(options: {
  rateLimiters?: AdminRateLimiters;
  trustProxy?: boolean;
  now?: () => number;
} = {}) {
  const audit = vi.fn();
  const engine = {
    lifecycleState: "active", currentSessionId: "s1", currentPhaseId: "q1", currentPhaseEpoch: 2,
    isDisplayConnected: true, displayHeartbeatAgeMs: 12, connectedParticipantCount: 3,
    adminStart: vi.fn(() => ({ ok: false, reason: "wrong-phase" })),
    adminIdle: vi.fn(() => ({ ok: true })), adminSkip: vi.fn(() => ({ ok: true })), adminRestart: vi.fn(() => ({ ok: true })),
  } as unknown as PhaseEngine;
  const data: AdminDataSource = {
    audit, recentErrors: async () => [{ message: "example" }],
    exportSession: async (id) => id === "s1" ? { json: { id }, csv: "id\n\"s1\"" } : null,
  };
  const app = Fastify();
  registerAdminRoutes(app, {
    token: "strong-admin-token",
    engine: () => engine,
    ready: true,
    startedAt: Date.now(),
    data,
    ...options,
  });
  return { app, engine, audit };
}

function rateLimiters(maxAuthenticatedRequests: number, maxAuthenticationFailures: number, windowMs = 1_000): AdminRateLimiters {
  return {
    authenticated: new InMemoryIpRateLimiter({ maxAttempts: maxAuthenticatedRequests, windowMs }),
    authenticationFailures: new InMemoryIpRateLimiter({ maxAttempts: maxAuthenticationFailures, windowMs }),
  };
}

describe("admin API", () => {
  it("protects every admin endpoint and exposes operational status", async () => {
    const { app } = setup();
    expect((await app.inject({ url: "/api/admin/status" })).statusCode).toBe(401);
    const response = await app.inject({ url: "/api/admin/status", headers: { authorization: "Bearer strong-admin-token" } });
    expect(response.json()).toMatchObject({ healthy: true, ready: true, displayConnected: true, displayHeartbeatAgeMs: 12, connectedParticipants: 3, sessionId: "s1", phaseId: "q1" });
  });

  it("authenticates and rate-limits admin routes even when their path is percent-encoded", async () => {
    const { app, engine } = setup({ rateLimiters: rateLimiters(2, 1), now: () => 10_000 });
    const encodedStatus = "/api/%61dmin/status";
    const encodedAction = "/api/%61dmin/%69dle";

    expect((await app.inject({ url: encodedStatus })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: encodedAction })).statusCode).toBe(429);
    expect(engine.adminIdle).not.toHaveBeenCalled();

    const headers = { authorization: "Bearer strong-admin-token" };
    expect((await app.inject({ url: encodedStatus, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: encodedAction, headers })).statusCode).toBe(200);
    expect((await app.inject({ url: encodedStatus, headers })).statusCode).toBe(429);
    expect(engine.adminIdle).toHaveBeenCalledOnce();
  });

  it("leaves headroom for the dashboard's normal two-request polling cycle", async () => {
    const { app } = setup({ now: () => 10_000 });
    const headers = { authorization: "Bearer strong-admin-token" };
    for (let request = 0; request < 62; request += 1) {
      const path = request % 2 === 0 ? "status" : "errors";
      expect((await app.inject({ url: `/api/admin/${path}`, headers })).statusCode).toBe(200);
    }
  });

  it("executes safe controls and audit-logs success and refusal", async () => {
    const { app, engine, audit } = setup(); const headers = { authorization: "Bearer strong-admin-token" };
    expect((await app.inject({ method: "POST", url: "/api/admin/idle", headers })).statusCode).toBe(200);
    expect(engine.adminIdle).toHaveBeenCalledOnce();
    expect((await app.inject({ method: "POST", url: "/api/admin/start", headers })).statusCode).toBe(409);
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("returns recent errors and JSON/CSV session exports", async () => {
    const { app } = setup(); const headers = { authorization: "Bearer strong-admin-token" };
    expect((await app.inject({ url: "/api/admin/errors", headers })).json()).toEqual({ errors: [{ message: "example" }] });
    expect((await app.inject({ url: "/api/admin/sessions/s1/export", headers })).json()).toEqual({ id: "s1" });
    const csv = await app.inject({ url: "/api/admin/sessions/s1/export?format=csv", headers });
    expect(csv.headers["content-type"]).toContain("text/csv"); expect(csv.body).toContain("s1");
    expect((await app.inject({ url: "/api/admin/sessions/missing/export", headers })).statusCode).toBe(404);
  });

  it("rate-limits authenticated requests and authentication failures in isolated buckets", async () => {
    const now = () => 10_000;
    const limiters = rateLimiters(2, 1);
    const { app } = setup({ rateLimiters: limiters, now });
    const headers = { authorization: "Bearer strong-admin-token" };

    expect((await app.inject({ url: "/api/admin/status" })).statusCode).toBe(401);
    const failedAuthLimit = await app.inject({ url: "/api/admin/status" });
    expect(failedAuthLimit.statusCode).toBe(429);
    expect(failedAuthLimit.headers["retry-after"]).toBe("1");
    expect(failedAuthLimit.json()).toEqual({ error: "rate_limited", retryAfterMs: 1_000 });

    // Bad-token traffic from the same IP cannot consume the authenticated allowance.
    expect((await app.inject({ url: "/api/admin/status", headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/admin/errors", headers })).statusCode).toBe(200);
    const authenticatedLimit = await app.inject({ url: "/api/admin/status", headers });
    expect(authenticatedLimit.statusCode).toBe(429);
    expect(authenticatedLimit.json()).toEqual({ error: "rate_limited", retryAfterMs: 1_000 });

    limiters.authenticated.clear();
    expect((await app.inject({ url: "/api/admin/status", headers })).statusCode).toBe(200);
  });

  it("uses the direct peer unless proxy trust is explicitly enabled", async () => {
    const headers = { authorization: "Bearer strong-admin-token" };
    const direct = setup({ rateLimiters: rateLimiters(1, 1), now: () => 10_000 });
    expect((await direct.app.inject({ url: "/api/admin/status", headers: { ...headers, "x-forwarded-for": "203.0.113.1" } })).statusCode).toBe(200);
    expect((await direct.app.inject({ url: "/api/admin/status", headers: { ...headers, "x-forwarded-for": "203.0.113.2" } })).statusCode).toBe(429);

    const proxied = setup({ rateLimiters: rateLimiters(1, 1), trustProxy: true, now: () => 10_000 });
    expect((await proxied.app.inject({ url: "/api/admin/status", headers: { ...headers, "x-forwarded-for": "203.0.113.1, 10.0.0.1" } })).statusCode).toBe(200);
    expect((await proxied.app.inject({ url: "/api/admin/status", headers: { ...headers, "x-forwarded-for": "203.0.113.2, 10.0.0.1" } })).statusCode).toBe(200);
    expect((await proxied.app.inject({ url: "/api/admin/status", headers: { ...headers, "x-forwarded-for": "203.0.113.1, 10.0.0.2" } })).statusCode).toBe(429);
  });
});
