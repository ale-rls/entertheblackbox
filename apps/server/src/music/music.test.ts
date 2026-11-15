import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { musicGainAt, parseServerMessage, type MusicMessage } from "@entertheblackbox/protocol";
import type { Phase } from "@entertheblackbox/scenario";
import type { WebSocket } from "ws";
import { registerAdminRoutes } from "../admin/admin.js";
import { MUSIC_START_LEAD_MS, MusicController, musicMediaUrl, musicTracksFromMedia } from "./music.js";

const display = () => {
  const sent: MusicMessage[] = [];
  return { sent, socket: { readyState: 1, send: (raw: string) => {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok || parsed.message.t !== "music") throw new Error("not a music message");
    sent.push(parsed.message);
  } } as unknown as WebSocket };
};
const narration = (id: string, music?: unknown) => ({ kind: "narration", id, text: "x", durationMs: 1000, next: "idle", ...(music ? { music } : {}) }) as unknown as Phase;
const library = [{ src: "Ambient Chords.mp3", bytes: 10 }, { src: "pulse.mp3", bytes: 20 }, { src: "curtain.mp4", bytes: 30 }, { src: "empty.mp3", bytes: 0 }];

const setup = () => {
  let now = 50_000;
  const screen = display();
  const ensureLocal = vi.fn(async (_src: string) => {});
  const music = new MusicController({ display: () => screen.socket, ensureLocal, tracks: async () => musicTracksFromMedia(library), now: () => now });
  return { music, screen, ensureLocal, advance: (ms: number) => { now += ms; }, now: () => now };
};

describe("musicTracksFromMedia", () => {
  it("offers non-empty library MP3s only, sorted", () => {
    expect(musicTracksFromMedia(library).map((track) => track.src)).toEqual(["Ambient Chords.mp3", "pulse.mp3"]);
  });
  it("keeps folders in media URLs and encodes names", () => {
    expect(musicMediaUrl("native-shows/assets/ab cd.mp3")).toBe("/media/native-shows/assets/ab%20cd.mp3");
  });
});

describe("MusicController", () => {
  it("starts on a scene cue, keeps playing through scenes without a cue, and stops on the idle scene", () => {
    const { music, screen, now } = setup();
    music.applyScene(narration("a", { action: "play", src: "pulse.mp3", volume: 0.5, fadeMs: 2_000 }));
    const started = screen.sent.at(-1)!;
    expect(started.track).toEqual({ src: "pulse.mp3", url: "/media/pulse.mp3" });
    expect(started.startAt).toBe(now() + MUSIC_START_LEAD_MS);
    expect(started.loop).toBe(true);
    expect(started.gain).toEqual({ from: 0, to: 0.5, at: now() + MUSIC_START_LEAD_MS, ms: 2_000 });

    const before = screen.sent.length;
    music.applyScene(narration("b"));
    expect(screen.sent.length).toBe(before);
    expect(music.snapshot().track).toBe("pulse.mp3");

    music.applyScene({ kind: "idle", id: "idle" } as Phase);
    expect(screen.sent.at(-1)!.track).toBeNull();
    expect(music.snapshot().track).toBeNull();
  });

  it("ramps volume from the current loudness and fades out before releasing the track", () => {
    const { music, screen, advance, now } = setup();
    music.applyScene(narration("a", { action: "play", src: "pulse.mp3", volume: 1 }));
    advance(1_000);
    music.applyScene(narration("b", { action: "volume", volume: 0.2, fadeMs: 4_000 }));
    expect(screen.sent.at(-1)!.gain).toEqual({ from: 1, to: 0.2, at: now(), ms: 4_000 });
    advance(2_000);
    expect(music.snapshot().volume).toBeCloseTo(0.6);

    music.applyScene(narration("c", { action: "stop", fadeMs: 3_000 }));
    const fading = screen.sent.at(-1)!;
    expect(fading.track?.src).toBe("pulse.mp3");
    expect(fading.stopAt).toBe(now() + 3_000);
    expect(musicGainAt(fading.gain, now())).toBeCloseTo(0.6);
    expect(music.snapshot().fadingOut).toBe(true);
    advance(3_000);
    expect(music.snapshot().track).toBeNull();
    // A volume change after the fade has nothing to act on.
    expect(music.setVolume(1, 0, "admin")).toBe(false);
  });

  it("lets Admin play a library track (made local first), and rejects unknown tracks", async () => {
    const { music, screen, ensureLocal } = setup();
    expect(await music.playFromLibrary("nope.mp3", { volume: 1, loop: true, fadeMs: 0 })).toEqual({ ok: false, error: "unknown_track" });
    expect(await music.playFromLibrary("Ambient Chords.mp3", { volume: 0.7, loop: false, fadeMs: 0 })).toEqual({ ok: true });
    expect(ensureLocal).toHaveBeenCalledWith("Ambient Chords.mp3");
    expect(screen.sent.at(-1)).toMatchObject({ track: { src: "Ambient Chords.mp3", url: "/media/Ambient%20Chords.mp3" }, loop: false });
    expect(music.snapshot()).toMatchObject({ source: "admin", volume: 0.7 });
  });

  it("welcomes a reconnecting display with the current state", () => {
    const { music } = setup();
    music.applyScene(narration("a", { action: "play", src: "pulse.mp3" }));
    const late = display();
    music.welcome(late.socket);
    expect(late.sent[0]).toMatchObject({ track: { src: "pulse.mp3" } });
  });
});

describe("Admin music routes", () => {
  it("requires an operator and plays, changes volume and stops", async () => {
    const { music, screen } = setup();
    const app = Fastify();
    registerAdminRoutes(app, { verifyToken: async (token) => token === "operator", engine: () => null, ready: true, startedAt: 0,
      music: { controller: music, tracks: async () => musicTracksFromMedia(library) } });
    const headers = { authorization: "Bearer operator" };
    try {
      expect((await app.inject({ method: "GET", url: "/api/admin/music" })).statusCode).toBe(401);
      const state = (await app.inject({ method: "GET", url: "/api/admin/music", headers })).json();
      expect(state.tracks.map((track: { src: string }) => track.src)).toEqual(["Ambient Chords.mp3", "pulse.mp3"]);
      expect(state.track).toBeNull();

      expect((await app.inject({ method: "POST", url: "/api/admin/music", headers, payload: { action: "volume", volume: 0.5 } })).statusCode).toBe(409);
      expect((await app.inject({ method: "POST", url: "/api/admin/music", headers, payload: { action: "play", src: "x.mp3" } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/api/admin/music", headers, payload: { action: "play", src: "pulse.mp3", volume: 2 } })).statusCode).toBe(400);
      const played = await app.inject({ method: "POST", url: "/api/admin/music", headers, payload: { action: "play", src: "pulse.mp3", volume: 0.8 } });
      expect(played.json().state).toMatchObject({ track: "pulse.mp3", source: "admin" });
      expect((await app.inject({ method: "POST", url: "/api/admin/music", headers, payload: { action: "volume", volume: 0.3, fadeMs: 0 } })).json().state.volume).toBe(0.3);
      const stopped = await app.inject({ method: "POST", url: "/api/admin/music", headers, payload: { action: "stop", fadeMs: 0 } });
      expect(stopped.json().state.track).toBeNull();
      expect(screen.sent.at(-1)!.track).toBeNull();
    } finally {
      await app.close();
    }
  });
});
