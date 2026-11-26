import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { PhaseEngine } from "../engine/phase-engine.js";
import { registerAdminRoutes } from "../admin/admin.js";
import { ENNIAH_VOICE_ID, elevenLabsVoice, pcmToWav, type Announcement, type AnnouncementStore, type GeneratedVoice } from "./announcements.js";

describe("pcmToWav", () => {
  it("writes a 48 kHz 16-bit mono WAV header around the samples", () => {
    const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]));
    const view = new DataView(wav.buffer);
    const text = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(4, true)).toBe(40);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4]);
  });
});

describe("elevenLabsVoice", () => {
  it("asks for the Enniah voice as 48 kHz PCM and measures the clip", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(new Uint8Array(96_000)));
    const voice = await elevenLabsVoice("key", undefined, fetchImpl as unknown as typeof fetch)("[amused] Hallo.");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${ENNIAH_VOICE_ID}?output_format=pcm_48000`);
    expect((init!.headers as Record<string, string>)["xi-api-key"]).toBe("key");
    expect(JSON.parse(String(init!.body))).toEqual({ text: "[amused] Hallo.", model_id: "eleven_v3", language_code: "de" });
    expect(voice.durationMs).toBe(1000);
    expect(voice.wav.byteLength).toBe(96_044);
  });

  it("reports the service's error", async () => {
    const fetchImpl = async () => new Response("quota exceeded", { status: 429 });
    await expect(elevenLabsVoice("key", "voice1234", fetchImpl as unknown as typeof fetch)("Hi")).rejects.toThrow("ElevenLabs 429: quota exceeded");
  });
});

function memoryStore(): AnnouncementStore & { clips: Announcement[] } {
  const clips: Announcement[] = [];
  return {
    clips,
    list: async () => [...clips],
    create: async (text: string, voice: GeneratedVoice) => { const clip = { id: `a${clips.length + 1}`, text, durationMs: voice.durationMs, createdAt: "2026-11-26" }; clips.unshift(clip); return clip; },
    remove: async (id: string) => { const index = clips.findIndex((clip) => clip.id === id); if (index < 0) throw new Error("not_found"); clips.splice(index, 1); },
    ensureLocal: async (id: string) => { const clip = clips.find((item) => item.id === id); if (!clip) throw new Error("not_found"); return { announcement: clip, url: `/media/announcements/${id}.wav` }; },
  };
}

describe("/api/admin/announcements", () => {
  const headers = { authorization: "Bearer operator" };
  const engineStub = () => {
    let playing: { id: string; url: string; durationMs: number; startedAt: number } | null = null;
    return {
      playAnnouncement: vi.fn((clip: { id: string; url: string; durationMs: number }) => { playing = { ...clip, startedAt: 1_300 }; return true; }),
      stopAnnouncement: vi.fn(() => { playing = null; return true; }),
      announcement: () => playing,
    } as unknown as PhaseEngine;
  };

  it("generates, keeps, plays, stops and deletes clips", async () => {
    const app = Fastify();
    const store = memoryStore();
    const engine = engineStub();
    const generate = vi.fn(async () => ({ wav: new Uint8Array(10), durationMs: 4_200 }));
    registerAdminRoutes(app, { verifyToken: async (token) => token === "operator", engine: () => engine, ready: true, startedAt: 0, now: () => 1_000, announcements: { store, generate } });
    try {
      expect((await app.inject({ method: "GET", url: "/api/admin/announcements" })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/admin/announcements", headers, payload: { text: "   " } })).statusCode).toBe(400);
      const created = await app.inject({ method: "POST", url: "/api/admin/announcements", headers, payload: { text: " Gleich geht es weiter. " } });
      expect(created.json()).toMatchObject({ ok: true, clip: { id: "a1", text: "Gleich geht es weiter.", durationMs: 4_200 } });
      expect(generate).toHaveBeenCalledWith("Gleich geht es weiter.");

      const played = await app.inject({ method: "POST", url: "/api/admin/announcements/a1/play", headers });
      expect(played.json()).toMatchObject({ ok: true, delivered: true, playing: { id: "a1", url: "/media/announcements/a1.wav", durationMs: 4_200 } });
      expect((await app.inject({ method: "GET", url: "/api/admin/announcements", headers })).json()).toMatchObject({ canGenerate: true, clips: [{ id: "a1" }], playing: { id: "a1" }, serverNow: 1_000 });
      expect((await app.inject({ method: "POST", url: "/api/admin/announcements/missing/play", headers })).statusCode).toBe(404);

      expect((await app.inject({ method: "POST", url: "/api/admin/announcements/stop", headers })).json()).toEqual({ ok: true, delivered: true });
      expect(engine.stopAnnouncement).toHaveBeenCalledTimes(1);

      await app.inject({ method: "POST", url: "/api/admin/announcements/a1/play", headers });
      expect((await app.inject({ method: "DELETE", url: "/api/admin/announcements/a1", headers })).json()).toEqual({ ok: true });
      expect(engine.stopAnnouncement).toHaveBeenCalledTimes(2);
      expect(store.clips).toEqual([]);
    } finally { await app.close(); }
  });

  it("still plays saved clips without a voice key, and says why it cannot generate", async () => {
    const app = Fastify();
    const store = memoryStore();
    await store.create("Gespeichert", { wav: new Uint8Array(2), durationMs: 900 });
    registerAdminRoutes(app, { verifyToken: async () => true, engine: () => engineStub(), ready: true, startedAt: 0, announcements: { store } });
    try {
      expect((await app.inject({ method: "GET", url: "/api/admin/announcements", headers })).json()).toMatchObject({ canGenerate: false });
      const response = await app.inject({ method: "POST", url: "/api/admin/announcements", headers, payload: { text: "Hallo" } });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "voice_unavailable" });
      expect((await app.inject({ method: "POST", url: "/api/admin/announcements/a1/play", headers })).json()).toMatchObject({ delivered: true });
    } finally { await app.close(); }
  });

  it("does not save a clip when the voice service fails", async () => {
    const app = Fastify();
    const store = memoryStore();
    registerAdminRoutes(app, { verifyToken: async () => true, engine: () => engineStub(), ready: true, startedAt: 0, announcements: { store, generate: async () => { throw new Error("ElevenLabs 401: bad key"); } } });
    try {
      const response = await app.inject({ method: "POST", url: "/api/admin/announcements", headers, payload: { text: "Hallo" } });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: "voice_failed", message: "ElevenLabs 401: bad key" });
      expect(store.clips).toEqual([]);
    } finally { await app.close(); }
  });
});
