import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Phase } from "@entertheblackbox/scenario";
import { PersonalAudio } from "./personal-audio.js";

const phase = (phoneAudioSrc?: string): Extract<Phase, { kind: "position-question" }> => ({
  kind: "position-question", id: "question", text: "Move", durationMs: 1_000,
  freezeMs: 0, connectionStaleAfterMs: 1_000, showLiveCounts: false,
  field: { type: "two-quadrant", axis: "x", variant: "spectrum", labels: { minLabel: "A", maxLabel: "B" } },
  next: { type: "fixed", target: "idle" }, ...(phoneAudioSrc ? { phoneAudioSrc } : {}),
});

describe("PersonalAudio", () => {
  it("advances one group without interrupting another, silences waiting phones and routes late audio registration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await Promise.all([writeFile(join(dir, "a.mp3"), "a"), writeFile(join(dir, "b.mp3"), "b")]);
    const calls: Array<{ url: string; body: unknown }> = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });
    await audio.register({ clientId: "two", name: "Two" });
    audio.transition(phase());
    await audio.register({ clientId: "two", name: "Two" }); // Drain transition.
    audio.transitionParticipants(["one", "late"], phase("a.mp3"));
    audio.transitionParticipants(["two"], phase("b.mp3"));
    await audio.register({ clientId: "late", name: "Late" });
    const plays = calls.filter((call) => call.url.endsWith("/play"));
    expect(plays.find((call) => call.url.includes("/one/"))?.body).toEqual(plays.find((call) => call.url.includes("/late/"))?.body);
    expect(plays.find((call) => call.url.includes("/one/"))?.body).not.toEqual(plays.find((call) => call.url.includes("/two/"))?.body);
    const before = calls.length;
    audio.transitionParticipants(["one"], { kind: "idle", id: "idle" });
    await audio.register({ clientId: "one", name: "One" });
    expect(calls.slice(before).some((call) => call.url.includes("/two/"))).toBe(false);
    expect(calls.slice(before).filter((call) => call.url.endsWith("/one/play"))).toHaveLength(0);
    expect(calls.slice(before).some((call) => call.url.endsWith("/one/reset"))).toBe(true);
    audio.transition(phase("b.mp3"));
    await audio.register({ clientId: "one", name: "One" });
    expect(calls.filter((call) => call.url.endsWith("/one/play"))).toHaveLength(2);
    await audio.stop();
  });
  it("uploads Studio audio once and injects it for current and late-registering phones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await writeFile(join(dir, "voice.mp3"), "voice");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({ players: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio(
      { url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request,
    );

    await audio.register({ clientId: "one", name: "One" });
    audio.transition(phase("voice.mp3"));
    await audio.register({ clientId: "two", name: "Two" });

    expect(calls.filter((call) => call.init?.method === "PUT" && call.url.includes("/audio/"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/players/one/play"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/players/two/play"))).toHaveLength(1);
    expect(await audio.register({ clientId: "two", name: "Two" })).toBe("https://audio.example/stream/two");
    expect(calls.filter((call) => call.url.endsWith("/players/two/play"))).toHaveLength(1);
    await audio.stop();
  });

  it("resets narration on silent transitions and releases all slots at session end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    const calls: string[] = [];
    const request = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio(
      { url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request,
    );
    await audio.register({ clientId: "one", name: "One" });
    audio.transition(phase());
    await audio.register({ clientId: "one", name: "One" });
    audio.endSession();
    await audio.stop();
    expect(calls).toContain("http://bridge/players/one/reset");
    expect(calls).toContain("http://bridge/players/one");
  });

  it("selects group-specific narration while retaining a broadcast fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await Promise.all([writeFile(join(dir, "all.mp3"), "all"), writeFile(join(dir, "red.mp3"), "red")]);
    const plays: Array<{ id: string; body: { file: string } }> = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const match = String(url).match(/\/players\/([^/]+)\/play$/);
      if (match) plays.push({ id: match[1]!, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });
    await audio.register({ clientId: "two", name: "Two" });
    const memberships = new Map([["one", "red"], ["two", "blue"]]);
    audio.transition({ ...phase("all.mp3"), phoneAudioByGroup: { red: "red.mp3" } }, (id) => memberships.get(id) ?? null);
    await audio.register({ clientId: "two", name: "Two" });
    expect(plays.map((play) => play.id).sort()).toEqual(["one", "two"]);
    expect(plays[0]!.body.file).not.toBe(plays[1]!.body.file);
    memberships.set("two", "red");
    await audio.refreshParticipant("two");
    await audio.stop();
    expect(plays).toHaveLength(3);
    expect(plays[2]).toEqual({ id: "two", body: plays.find((play) => play.id === "one")!.body });
  });

  it("plays and stops a soundcheck on one registered phone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await writeFile(join(dir, "test.mp3"), "test");
    const calls: string[] = [];
    const request = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });
    await audio.register({ clientId: "two", name: "Two" });
    expect(await audio.soundcheck("test.mp3", "one")).toBe(1);
    expect(await audio.stopSoundcheck("one")).toBe(1);
    expect(calls.filter((url) => url.endsWith("/players/one/play"))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith("/players/two/play"))).toHaveLength(0);
    expect(calls.filter((url) => url.endsWith("/players/one/reset"))).toHaveLength(2);
    await audio.stop();
  });
});
