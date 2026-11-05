import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS, parseServerMessage, type SurfaceMessage } from "@entertheblackbox/protocol";
import type { WebSocket } from "ws";
import { registerAdminRoutes } from "../admin/admin.js";
import { SURFACE_IDENTIFY_HOLD_MS, SurfaceController } from "./surface.js";

const socket = (readyState = 1) => {
  const sent: SurfaceMessage[] = [];
  return { sent, socket: { readyState, send: (raw: string) => {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok || parsed.message.t !== "surface") throw new Error("not a surface message");
    sent.push(parsed.message);
  } } as unknown as WebSocket };
};

describe("SurfaceController", () => {
  const setup = () => {
    const a = socket(), b = socket(), closed = socket(3);
    const controller = new SurfaceController({ now: () => 1_000, leadMs: 60, recipients: () => [
      { clientId: "a", name: "T01", socket: a.socket }, { clientId: "b", name: "T02", socket: b.socket }, { clientId: "c", name: "T03", socket: closed.socket },
    ] });
    return { a, b, closed, controller };
  };

  it("schedules one shared applyAt for every addressed device and skips closed sockets", () => {
    const { a, b, closed, controller } = setup();
    expect(controller.play("all", { mode: "flash", color: "#ff0000", holdMs: 250 })).toBe(2);
    expect(a.sent[0]).toMatchObject({ mode: "flash", color: "#ff0000", holdMs: 250, applyAt: 1_060 });
    expect(b.sent[0]!.applyAt).toBe(a.sent[0]!.applyAt);
    expect(closed.sent).toHaveLength(0);
  });

  it("targets selected devices, identifies by name and releases to the base colour", () => {
    const { a, b, controller } = setup();
    controller.restoreBase("#112233");
    expect(controller.play(["b"], { mode: "identify" })).toBe(1);
    expect(b.sent[0]).toMatchObject({ mode: "flash", color: "#ffffff", holdMs: SURFACE_IDENTIFY_HOLD_MS, label: "T02" });
    controller.play(["b"], { mode: "release" });
    expect(b.sent[1]).toMatchObject({ mode: "release", color: "#112233" });
    expect(b.sent[1]!.seq).toBeGreaterThan(b.sent[0]!.seq);
    expect(a.sent).toHaveLength(0);
  });

  it("broadcasts base changes and welcomes new sockets with the current base immediately", () => {
    const { a, controller } = setup();
    controller.setBase("#00ff00");
    expect(a.sent[0]).toMatchObject({ mode: "set", color: "#00ff00" });
    const fresh = socket();
    controller.welcome(fresh.socket);
    expect(fresh.sent[0]).toMatchObject({ mode: "set", color: "#00ff00", applyAt: 1_000 });
  });
});

describe("POST /api/admin/surface", () => {
  it("authenticates, validates and forwards gestures; display settings push the base colour", async () => {
    const app = Fastify();
    const surface = { play: vi.fn(() => 3), setBase: vi.fn(() => 3) };
    registerAdminRoutes(app, { verifyToken: async (token) => token === "operator", engine: () => null, ready: true, startedAt: 0, surface,
      displaySettings: { read: async () => DEFAULT_DISPLAY_SETTINGS, write: async (value) => value } });
    const headers = { authorization: "Bearer operator" };
    try {
      expect((await app.inject({ method: "POST", url: "/api/admin/surface", payload: { target: "all", mode: "release" } })).statusCode).toBe(401);
      for (const payload of [{ target: "all", mode: "flash" }, { target: [], mode: "release" }, { target: "all", mode: "flash", color: "red" }, { target: "all", mode: "boom" }]) {
        expect((await app.inject({ method: "POST", url: "/api/admin/surface", headers, payload })).statusCode).toBe(400);
      }
      const response = await app.inject({ method: "POST", url: "/api/admin/surface", headers, payload: { target: ["a", "b"], mode: "flash", color: "#ff00aa", holdMs: 250 } });
      expect(response.json()).toEqual({ ok: true, delivered: 3 });
      expect(surface.play).toHaveBeenCalledWith(["a", "b"], { mode: "flash", color: "#ff00aa", holdMs: 250 });
      await app.inject({ method: "POST", url: "/api/admin/surface", headers, payload: { target: ["a"], mode: "identify" } });
      expect(surface.play).toHaveBeenLastCalledWith(["a"], { mode: "identify" });
      await app.inject({ method: "PUT", url: "/api/admin/settings/display", headers, payload: { ...DEFAULT_DISPLAY_SETTINGS, phoneSurfaceColor: "#123456" } });
      expect(surface.setBase).toHaveBeenCalledWith("#123456");
    } finally { await app.close(); }
  });
});
