import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { SurfaceEffect } from "@entertheblackbox/shared";
import { registerAdminRoutes } from "../admin/admin.js";
import { SURFACE_EFFECT_REFRESH_FRAMES, SurfaceEffectRunner } from "./effects.js";

const chase: SurfaceEffect = { kind: "chase", color: "#ff0000", color2: "#0000ff", periodMs: 1_000, brightness: 1 };

const setup = () => {
  let now = 0;
  let tick: (() => void) | null = null;
  const surface = { paint: vi.fn((colors: ReadonlyMap<string, string>) => colors.size), play: vi.fn(() => 2) };
  const timers = { setInterval: vi.fn((work: () => void) => { tick = work; return 1; }), clearInterval: vi.fn(() => { tick = null; }) };
  const runner = new SurfaceEffectRunner(surface, { now: () => now, timers });
  return { surface, timers, runner, advance: (ms: number) => { now += ms; tick?.(); }, painted: (call: number) => Object.fromEntries(surface.paint.mock.calls[call]![0]) };
};

describe("SurfaceEffectRunner", () => {
  it("paints the first frame at once, then only devices whose colour changed", () => {
    const { runner, surface, advance, painted } = setup();
    runner.start(chase, ["a", "b", "c", "d"]);
    expect(painted(0)).toEqual({ a: "#ff0000", b: "#000000", c: "#000000", d: "#590000" });
    advance(10);
    expect(painted(1)).toEqual({});
    advance(250);
    expect(painted(2)).toEqual({ a: "#590000", b: "#ff0000", d: "#000000" });
    expect(surface.paint).toHaveBeenCalledTimes(3);
  });

  it("refreshes every device periodically so reconnecting tablets catch up", () => {
    const { runner, advance, painted } = setup();
    runner.start({ ...chase, periodMs: 60_000 }, ["a", "b"]);
    for (let i = 1; i < SURFACE_EFFECT_REFRESH_FRAMES; i += 1) advance(1);
    expect(painted(SURFACE_EFFECT_REFRESH_FRAMES - 1)).toEqual({});
    advance(1);
    expect(Object.keys(painted(SURFACE_EFFECT_REFRESH_FRAMES))).toEqual(["a", "b"]);
  });

  it("keeps phase when the same effect is updated, releases dropped devices, and releases everything on stop", () => {
    const { runner, surface, timers, advance } = setup();
    runner.start(chase, ["a", "b"]);
    advance(500);
    runner.start({ ...chase, periodMs: 2_000, brightness: 0.5 }, ["a"]);
    expect(runner.state!.startedAt).toBe(-500);
    expect(surface.play).toHaveBeenCalledWith(["b"], { mode: "release" });
    expect(timers.setInterval).toHaveBeenCalledTimes(1);
    runner.start({ ...chase, kind: "wave" }, ["a"]);
    expect(runner.state!.startedAt).toBe(500);
    expect(runner.stop()).toBe(2);
    expect(surface.play).toHaveBeenLastCalledWith(["a"], { mode: "release" });
    expect(timers.clearInterval).toHaveBeenCalled();
    expect(runner.state).toBeNull();
    expect(runner.stop()).toBe(0);
  });
});

describe("POST /api/admin/surface/effect", () => {
  it("authenticates, validates, starts and stops effects", async () => {
    const app = Fastify();
    const surfaceEffects = { start: vi.fn(() => 4), stop: vi.fn(() => 4), state: null };
    registerAdminRoutes(app, { verifyToken: async (token) => token === "operator", engine: () => null, ready: true, startedAt: 0, surfaceEffects });
    const headers = { authorization: "Bearer operator" };
    const url = "/api/admin/surface/effect";
    try {
      expect((await app.inject({ method: "POST", url, payload: { action: "stop" } })).statusCode).toBe(401);
      for (const payload of [{ action: "start", effect: { ...chase, kind: "strobe" }, order: [] }, { action: "start", effect: { ...chase, periodMs: 10 }, order: [] },
        { action: "start", effect: { ...chase, brightness: 2 }, order: [] }, { action: "start", effect: chase }, { action: "boom" }]) {
        expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(400);
      }
      const started = await app.inject({ method: "POST", url, headers, payload: { action: "start", effect: chase, order: ["a", "b"] } });
      expect(started.json()).toMatchObject({ ok: true, delivered: 4 });
      expect(started.json().serverNow).toEqual(expect.any(Number));
      expect(surfaceEffects.start).toHaveBeenCalledWith(chase, ["a", "b"]);
      await app.inject({ method: "POST", url, headers, payload: { action: "stop" } });
      expect(surfaceEffects.stop).toHaveBeenCalled();
      expect((await app.inject({ method: "GET", url, headers })).json()).toMatchObject({ running: null });
    } finally { await app.close(); }
  });
});
