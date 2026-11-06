import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { parseServerMessage, PROTOCOL_VERSION, type WallMessage } from "@entertheblackbox/protocol";
import { DEFAULT_WALL_LAYOUT } from "@entertheblackbox/shared";
import type { WebSocket } from "ws";
import { registerAdminRoutes } from "../admin/admin.js";
import { VideoWallController, wallClipsFromMedia, WALL_PLAY_LEAD_MS } from "./wall.js";

const hash = (c: string) => c.repeat(64);
const socket = (readyState = 1) => {
  const sent: WallMessage[] = [];
  return { sent, socket: { readyState, send: (raw: string) => {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok || parsed.message.t !== "wall") throw new Error("not a wall message");
    sent.push(parsed.message);
  } } as unknown as WebSocket };
};
const media = [
  { src: "ocean__A1.mp4", bytes: 10, hash: hash("a") },
  { src: "ocean__A2.mp4", bytes: 20, hash: hash("b") },
  { src: "fire__A1.mp4", bytes: 30, hash: hash("c") },
  { src: "fire__A9.mp4", bytes: 30 },
  { src: "intro.mp4", bytes: 40, hash: hash("d") },
];

describe("wallClipsFromMedia", () => {
  it("groups <clip>__<slot>.mp4 files and skips unhashed or unrelated media", () => {
    expect(wallClipsFromMedia(media)).toEqual([
      { id: "fire", slices: { A1: { src: "fire__A1.mp4", bytes: 30, sha256: hash("c") } } },
      { id: "ocean", slices: { A1: { src: "ocean__A1.mp4", bytes: 10, sha256: hash("a") }, A2: { src: "ocean__A2.mp4", bytes: 20, sha256: hash("b") } } },
    ]);
  });
});

describe("VideoWallController", () => {
  const setup = () => {
    let now = 10_000;
    const t1 = socket(), t2 = socket(), spare = socket(), closed = socket(3);
    const ensureLocal = vi.fn(async (_src: string) => {});
    const wall = new VideoWallController({
      now: () => now, ensureLocal, clips: async () => wallClipsFromMedia(media),
      recipients: () => [
        { clientId: "c1", name: "T01", socket: t1.socket }, { clientId: "c2", name: "T02", socket: t2.socket },
        { clientId: "c3", name: "T03", socket: spare.socket }, { clientId: "c4", name: "T04", socket: closed.socket },
      ],
    });
    wall.restoreLayout({ ...DEFAULT_WALL_LAYOUT, cols: 2, rows: 1, slots: { A1: "T01", A2: "t02", B1: "T03" } });
    return { wall, t1, t2, spare, closed, ensureLocal, advance: (ms: number) => { now += ms; } };
  };

  it("loads a clip: each tablet gets its own slice, unassigned tablets get none, files are synced locally", async () => {
    const { wall, t1, t2, spare, closed, ensureLocal } = setup();
    expect(await wall.load("ocean")).toEqual({ ok: true, delivered: 3 });
    expect(t1.sent[0]).toMatchObject({ t: "wall", v: PROTOCOL_VERSION, startAt: null, loop: true,
      clip: { id: "ocean", slot: "A1", url: "/media/ocean__A1.mp4", bytes: 10, sha256: hash("a") } });
    expect(t2.sent[0]!.clip).toMatchObject({ slot: "A2", url: "/media/ocean__A2.mp4" });
    // B1 is outside the 2×1 layout.
    expect(spare.sent[0]!.clip).toBeNull();
    expect(closed.sent).toHaveLength(0);
    expect(ensureLocal.mock.calls.map(([src]) => src)).toEqual(["ocean__A1.mp4", "ocean__A2.mp4"]);
    expect(await wall.load("nope")).toEqual({ ok: false, error: "unknown_clip" });
  });

  it("plays on a shared start time, cues, loops, stops, and welcomes late joiners with the current state", async () => {
    const { wall, t1, t2 } = setup();
    expect(wall.play()).toEqual({ ok: false, error: "no_clip_loaded" });
    await wall.load("ocean");
    expect(wall.play()).toMatchObject({ ok: true, startAt: 10_000 + WALL_PLAY_LEAD_MS });
    expect(t1.sent.at(-1)!.startAt).toBe(t2.sent.at(-1)!.startAt);
    expect(t1.sent.at(-1)!.seq).toBeGreaterThan(t1.sent[0]!.seq);
    wall.setLoop(false);
    expect(t1.sent.at(-1)).toMatchObject({ loop: false, startAt: 10_000 + WALL_PLAY_LEAD_MS });
    const late = socket();
    wall.welcome(late.socket, "T02");
    expect(late.sent[0]).toMatchObject({ clip: { slot: "A2" }, startAt: 10_000 + WALL_PLAY_LEAD_MS });
    wall.cue();
    expect(t1.sent.at(-1)).toMatchObject({ startAt: null, clip: { id: "ocean" } });
    wall.stop();
    expect(t1.sent.at(-1)).toMatchObject({ startAt: null, clip: null });
  });

  it("re-sends slices when the layout changes and reports device status", async () => {
    const { wall, t1, advance } = setup();
    await wall.load("ocean");
    wall.setLayout({ ...wall.layout, slots: { A1: "T02", A2: "T01" } });
    expect(t1.sent.at(-1)!.clip).toMatchObject({ slot: "A2" });
    advance(5);
    wall.report("c1", { t: "wall_status", v: PROTOCOL_VERSION, clip: "ocean", state: "playing", driftMs: 12 });
    const snapshot = wall.snapshot();
    expect(snapshot.state).toEqual({ clip: "ocean", startAt: null, loop: true });
    expect(snapshot.devices[0]).toEqual({ clientId: "c1", name: "T01", slot: "A2", connected: true, status: { clip: "ocean", state: "playing", driftMs: 12, at: 10_005 } });
    expect(snapshot.devices[3]).toMatchObject({ name: "T04", slot: null, connected: false });
  });
});

describe("/api/admin/wall", () => {
  it("authenticates, validates layouts and commands, and drives the controller", async () => {
    const app = Fastify();
    const controller = {
      snapshot: vi.fn(() => ({ layout: DEFAULT_WALL_LAYOUT, state: { clip: null, startAt: null, loop: true }, devices: [], serverNow: 1 })),
      setLayout: vi.fn(() => 2), load: vi.fn(async (clip: string) => clip === "ocean" ? { ok: true as const, delivered: 2 } : { ok: false as const, error: "unknown_clip" }),
      play: vi.fn(() => ({ ok: true as const, delivered: 2, startAt: 5 })), cue: vi.fn(() => 2), stop: vi.fn(() => 2), setLoop: vi.fn(() => 2),
    };
    const saveLayout = vi.fn(async (layout: typeof DEFAULT_WALL_LAYOUT) => layout);
    registerAdminRoutes(app, { verifyToken: async (token) => token === "operator", engine: () => null, ready: true, startedAt: 0,
      wall: { controller, clips: async () => wallClipsFromMedia(media), saveLayout } });
    const headers = { authorization: "Bearer operator" };
    try {
      expect((await app.inject({ method: "GET", url: "/api/admin/wall" })).statusCode).toBe(401);
      const state = (await app.inject({ method: "GET", url: "/api/admin/wall", headers })).json();
      expect(state.clips.map((clip: { id: string }) => clip.id)).toEqual(["fire", "ocean"]);

      for (const payload of [{ ...DEFAULT_WALL_LAYOUT, cols: 0 }, { ...DEFAULT_WALL_LAYOUT, slots: { a1: "T01" } }, { ...DEFAULT_WALL_LAYOUT, extra: 1 }]) {
        expect((await app.inject({ method: "PUT", url: "/api/admin/wall/layout", headers, payload })).statusCode).toBe(400);
      }
      const layout = { ...DEFAULT_WALL_LAYOUT, slots: { A1: " T01 " } };
      expect((await app.inject({ method: "PUT", url: "/api/admin/wall/layout", headers, payload: layout })).json()).toMatchObject({ ok: true, delivered: 2 });
      expect(saveLayout).toHaveBeenCalledWith({ ...layout, slots: { A1: "T01" } });
      expect(controller.setLayout).toHaveBeenCalled();

      expect((await app.inject({ method: "POST", url: "/api/admin/wall", headers, payload: { action: "boom" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/admin/wall", headers, payload: { action: "load", clip: "nope" } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/api/admin/wall", headers, payload: { action: "load", clip: "ocean" } })).json()).toEqual({ ok: true, delivered: 2 });
      expect((await app.inject({ method: "POST", url: "/api/admin/wall", headers, payload: { action: "play", leadMs: 2_000 } })).json()).toMatchObject({ startAt: 5 });
      expect(controller.play).toHaveBeenCalledWith(2_000);
      await app.inject({ method: "POST", url: "/api/admin/wall", headers, payload: { action: "loop", loop: false } });
      expect(controller.setLoop).toHaveBeenCalledWith(false);
      await app.inject({ method: "POST", url: "/api/admin/wall", headers, payload: { action: "stop" } });
      expect(controller.stop).toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
