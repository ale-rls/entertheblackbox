import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { InMemoryIpRateLimiter } from "../admission/rate-limit.js";
import type { PhaseEngine } from "../engine/phase-engine.js";
import type { PublishedShowArtifact, PublishedShowSummary } from "../readiness.js";
import { registerAdminRoutes, type AdminDataSource, type AdminRateLimiters } from "./admin.js";

function setup(options: {
  rateLimiters?: AdminRateLimiters;
  trustProxy?: boolean;
  now?: () => number;
  showConfig?: {
    activeShowId: string | null;
    list: () => Promise<PublishedShowSummary[]>;
    readPending: () => Promise<string | null>;
    write: (showId: string) => Promise<void>;
    latest?: (showId?: string) => Promise<PublishedShowArtifact | null>;
    publish: (record: { showId: string; name: string; scenario: unknown; mediaManifest: unknown }) => Promise<PublishedShowSummary>;
  };
} = {}) {
  const audit = vi.fn();
  let lobbyTimes = [20_000, 40_000];
  const engine = {
    lifecycleState: "active", currentSessionId: "s1", currentPhaseId: "q1", currentPhaseEpoch: 2,
    isDisplayConnected: true, displayHeartbeatAgeMs: 12, connectedParticipantCount: 3,
    participantPresence: [{ clientId: "p1", name: "Ada", color: "#fff", connected: true, joinedAt: 500, lastSeenAt: 900 }],
    get lobbyStartTimes() { return lobbyTimes; },
    get nextLobbyStartAt() { return lobbyTimes[0] ?? null; },
    setLobbyStartTimes: vi.fn((times: readonly number[]) => { lobbyTimes = [...times]; return { ok: true }; }),
    currentDisplayPlaybackIssue: { status: "stalled", mediaId: "intro.mp4", detail: "buffering stopped", reportedAt: 1_000 },
    adminStart: vi.fn(() => ({ ok: false, reason: "wrong-phase" })),
    adminIdle: vi.fn(() => ({ ok: true })), adminSkip: vi.fn(() => ({ ok: true })), adminRestart: vi.fn(() => ({ ok: true })),
  } as unknown as PhaseEngine;
  const data: AdminDataSource = {
    audit, recentErrors: async () => [{ message: "example" }],
    exportSession: async (id) => id === "s1" ? { json: { id }, csv: "id\n\"s1\"" } : null,
  };
  const app = Fastify();
  registerAdminRoutes(app, {
    verifyToken: async (token) => token === "strong-admin-token",
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
    expect(response.json()).toMatchObject({
      healthy: true,
      ready: true,
      displayConnected: true,
      displayHeartbeatAgeMs: 12,
      displayPlaybackIssue: { status: "stalled", mediaId: "intro.mp4", detail: "buffering stopped", reportedAt: 1_000 },
      connectedParticipants: 3,
      participants: [expect.objectContaining({ name: "Ada", connected: true })],
      sessionId: "s1",
      phaseId: "q1",
    });
  });

  it("replaces and adjusts the persisted lobby schedule", async () => {
    const { app, engine, audit } = setup({ now: () => 1_000 });
    const headers = { authorization: "Bearer strong-admin-token" };

    expect((await app.inject({ url: "/api/admin/lobby", headers })).json()).toMatchObject({
      startTimes: [20_000, 40_000], nextStartAt: 20_000,
    });
    const saved = await app.inject({
      method: "POST", url: "/api/admin/lobby", headers, payload: { startTimes: [50_000, 30_000] },
    });
    expect(saved.statusCode).toBe(200);
    expect(engine.setLobbyStartTimes).toHaveBeenCalledWith([30_000, 50_000], 1_000);

    const adjusted = await app.inject({
      method: "POST", url: "/api/admin/lobby/adjust", headers, payload: { deltaMs: 10_000 },
    });
    expect(adjusted.statusCode).toBe(200);
    expect(adjusted.json()).toMatchObject({ nextStartAt: 40_000 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "adjust-lobby-start" }));
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

  it("leaves headroom for the dashboard's normal polling cycle", async () => {
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

  it("lists available shows and switches the pending active show", async () => {
    const shows: PublishedShowSummary[] = [
      { showId: "show-a", name: "Election night", version: "1.0.0", publishedAt: 1_000 },
      { showId: "show-b", name: "Housing town hall", version: "2.0.0", publishedAt: 2_000 },
    ];
    let pending: string | null = null;
    const write = vi.fn(async (showId: string) => { pending = showId; });
    const { app, audit } = setup({
      showConfig: {
        activeShowId: "show-a",
        list: async () => shows,
        readPending: async () => pending,
        write,
        publish: vi.fn(),
      },
    });
    const headers = { authorization: "Bearer strong-admin-token" };

    expect((await app.inject({ url: "/api/admin/shows", headers })).json()).toEqual({
      active: "show-a",
      pending: null,
      shows,
    });

    const invalid = await app.inject({
      method: "POST", url: "/api/admin/shows", headers, payload: { showId: "not-a-real-show" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "unknown_show_id" });
    expect(write).not.toHaveBeenCalled();

    const saved = await app.inject({
      method: "POST", url: "/api/admin/shows", headers, payload: { showId: "show-b" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ ok: true, pending: "show-b" });
    expect(write).toHaveBeenCalledWith("show-b");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "set-active-show" }));

    expect((await app.inject({ url: "/api/admin/shows", headers })).json()).toMatchObject({
      active: "show-a",
      pending: "show-b",
    });
  });

  it("publishes a new show from a request body, matching Studio's export shape", async () => {
    const publish = vi.fn(async (record: { showId: string; name: string; scenario: unknown; mediaManifest: unknown }) => ({
      showId: record.showId, name: record.name, version: "1.0.0", publishedAt: 5_000,
    }));
    const { app, audit } = setup({
      showConfig: { activeShowId: null, list: async () => [], readPending: async () => null, write: vi.fn(), publish },
    });
    const headers = { authorization: "Bearer strong-admin-token" };

    const invalid = await app.inject({
      method: "POST", url: "/api/admin/publish", headers, payload: { showId: "has spaces", name: "x", scenario: {}, mediaManifest: {} },
    });
    expect(invalid.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();

    const published = await app.inject({
      method: "POST", url: "/api/admin/publish", headers,
      payload: { showId: "draft-a", name: "Election night", scenario: { version: "1.0.0" }, mediaManifest: { files: [] } },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({ ok: true, show: { showId: "draft-a", name: "Election night", version: "1.0.0", publishedAt: 5_000 } });
    expect(publish).toHaveBeenCalledWith({ showId: "draft-a", name: "Election night", scenario: { version: "1.0.0" }, mediaManifest: { files: [] } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "publish-show" }));
  });

  it("returns the immutable latest production artifact and rejects stale-baseline publishing", async () => {
    const artifact = {
      recordId: "record-current",
      showId: "show-a",
      name: "Main v4",
      version: "1.0.0",
      publishedAt: 5_000,
      scenario: { version: "1.0.0", phases: [] },
      mediaManifest: { files: [] },
    };
    const publish = vi.fn(async () => ({ showId: "show-a", name: "Main v5", version: "1.1.0", publishedAt: 6_000 }));
    const { app } = setup({
      showConfig: {
        activeShowId: "show-a",
        list: async () => [],
        readPending: async () => null,
        write: vi.fn(),
        latest: async () => artifact,
        publish,
      },
    });
    const headers = { authorization: "Bearer strong-admin-token" };

    const latest = await app.inject({ url: "/api/admin/shows/latest", headers });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toEqual(artifact);

    const stale = await app.inject({
      method: "POST",
      url: "/api/admin/publish",
      headers,
      payload: {
        showId: "show-a",
        name: "Main v5",
        scenario: { version: "1.1.0" },
        mediaManifest: { files: [] },
        baseRecordId: "record-old",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: "stale_production_baseline", latest: { recordId: "record-current" } });
    expect(publish).not.toHaveBeenCalled();

    const current = await app.inject({
      method: "POST",
      url: "/api/admin/publish",
      headers,
      payload: {
        showId: "show-a",
        name: "Main v5",
        scenario: { version: "1.1.0" },
        mediaManifest: { files: [] },
        baseRecordId: "record-current",
      },
    });
    expect(current.statusCode).toBe(200);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("returns 503 for publish when no show store is configured", async () => {
    const { app } = setup();
    const headers = { authorization: "Bearer strong-admin-token" };
    expect((await app.inject({ method: "POST", url: "/api/admin/publish", headers, payload: {} })).statusCode).toBe(503);
  });

  it("returns 503 for show routes when no store is configured", async () => {
    const { app } = setup();
    const headers = { authorization: "Bearer strong-admin-token" };
    expect((await app.inject({ url: "/api/admin/shows", headers })).statusCode).toBe(503);
    expect((await app.inject({ method: "POST", url: "/api/admin/shows", headers, payload: {} })).statusCode).toBe(503);
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
