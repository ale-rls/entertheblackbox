import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { PhaseEngine } from "../engine/phase-engine.js";
import { registerAdminRoutes, type AdminDataSource } from "./admin.js";

function setup() {
  const audit = vi.fn();
  const engine = {
    lifecycleState: "active", currentSessionId: "s1", currentPhaseId: "q1", currentPhaseEpoch: 2,
    isDisplayConnected: true, displayHeartbeatAgeMs: 12, connectedParticipantCount: 3,
    currentDisplayPlaybackIssue: { status: "stalled", mediaId: "intro.mp4", detail: "buffering stopped", reportedAt: 1_000 },
    adminStart: vi.fn(() => ({ ok: false, reason: "wrong-phase" })),
    adminIdle: vi.fn(() => ({ ok: true })), adminSkip: vi.fn(() => ({ ok: true })), adminRestart: vi.fn(() => ({ ok: true })),
  } as unknown as PhaseEngine;
  const data: AdminDataSource = {
    audit, recentErrors: async () => [{ message: "example" }],
    exportSession: async (id) => id === "s1" ? { json: { id }, csv: "id\n\"s1\"" } : null,
  };
  const app = Fastify();
  registerAdminRoutes(app, { token: "strong-admin-token", engine: () => engine, ready: true, startedAt: Date.now(), data });
  return { app, engine, audit };
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
      sessionId: "s1",
      phaseId: "q1",
    });
  });

  it("authenticates admin routes even when their path is percent-encoded", async () => {
    const { app, engine } = setup();
    const encodedStatus = "/api/%61dmin/status";
    const encodedAction = "/api/%61dmin/%69dle";

    expect((await app.inject({ url: encodedStatus })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: encodedAction })).statusCode).toBe(401);
    expect(engine.adminIdle).not.toHaveBeenCalled();

    const headers = { authorization: "Bearer strong-admin-token" };
    expect((await app.inject({ url: encodedStatus, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: encodedAction, headers })).statusCode).toBe(200);
    expect(engine.adminIdle).toHaveBeenCalledOnce();
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
});
