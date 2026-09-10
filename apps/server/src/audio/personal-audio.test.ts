import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Phase } from "@entertheblackbox/scenario";
import { PersonalAudio } from "./personal-audio.js";

const phase = (phoneAudioSrc?: string): Phase => ({
  kind: "position-question", id: "question", text: "Move", durationMs: 1_000,
  freezeMs: 0, connectionStaleAfterMs: 1_000, showLiveCounts: false,
  field: { type: "two-quadrant", axis: "x", variant: "spectrum", labels: { minLabel: "A", maxLabel: "B" } },
  next: { type: "fixed", target: "idle" }, ...(phoneAudioSrc ? { phoneAudioSrc } : {}),
});

describe("PersonalAudio", () => {
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
});
