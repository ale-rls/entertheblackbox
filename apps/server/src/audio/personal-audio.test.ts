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
  it("does not play superseded audio when a transfer happens during reset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await Promise.all([writeFile(join(dir, "a.mp3"), "a"), writeFile(join(dir, "b.mp3"), "b")]);
    let release: (() => void) | undefined;
    let resetStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { resetStarted = resolve; });
    let hold = false;
    const plays: unknown[] = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/reset") && hold) {
        hold = false;
        await new Promise<void>((resolve) => { release = resolve; resetStarted!(); });
      }
      if (String(url).endsWith("/play")) plays.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "x", publicUrl: "http://audio" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });
    audio.transition(phase());
    await audio.register({ clientId: "one", name: "One" });
    hold = true;
    audio.transitionParticipants(["one"], phase("a.mp3"));
    await started;
    audio.transitionParticipants(["one"], phase("b.mp3"));
    release!();
    await audio.register({ clientId: "one", name: "One" });
    expect(plays).toHaveLength(1);
    await audio.stop();
  });

  it("joins current playback after upload/reset latency and keeps that clock on recovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await writeFile(join(dir, "voice.mp3"), "voice");
    let now = 1000;
    const plays: Array<{ url: string; offsetSeconds: number }> = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/reset")) now += 250;
      if (String(url).endsWith("/play")) plays.push({ url: String(url), ...JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "x", publicUrl: "http://audio" }, dir, vi.fn(), request, () => {}, () => now);
    await audio.register({ clientId: "one", name: "One" });
    audio.transition(phase());
    await audio.register({ clientId: "one", name: "One" });
    now = 4500;
    audio.transitionParticipants(["one", "late"], phase("voice.mp3"), 1000);
    await audio.register({ clientId: "late", name: "Late" });
    expect(plays.map((p) => p.offsetSeconds)).toEqual([3.75, 4]);
    now = 8000;
    await audio.refreshParticipant("one");
    expect(plays.at(-1)?.offsetSeconds).toBe(7.25);
    now = 9000;
    await audio.setBackend({ kind: "remote" });
    expect(plays.slice(-2).every((p) => p.offsetSeconds >= 8)).toBe(true);
    await audio.stop();
  });

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
  it("reports and retries only failed narration recipients while phones sleep", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await writeFile(join(dir, "voice.mp3"), "voice");
    const plays: string[] = [];
    let broken = true;
    const request = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/play")) {
        plays.push(value);
        if (broken && value.includes("/two/")) return new Response("unavailable", {status: 503});
      }
      return new Response('{"players":[]}', {status: 200});
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({url: "http://bridge", token: "secret", publicUrl: "https://audio.test"}, dir, vi.fn(), request);
    await audio.register({clientId: "one", name: "One"});
    await audio.register({clientId: "two", name: "Two"});
    audio.transition(phase("voice.mp3"));
    await audio.register({clientId: "one", name: "One"}); // Wait for all delivery results.
    expect(await audio.status()).toMatchObject({deliveryFailures: {two: expect.stringContaining("503")}});
    broken = false;
    vi.useFakeTimers();
    try {
      audio.start();
      await vi.advanceTimersByTimeAsync(5000);
      await audio.register({clientId: "one", name: "One"});
      expect(await audio.status()).toMatchObject({deliveryFailures: {}});
      expect(plays.filter(url => url.includes("/one/"))).toHaveLength(1);
      expect(plays.filter(url => url.includes("/two/"))).toHaveLength(2);
    } finally { await audio.stop(); vi.useRealTimers(); }
  });
  it("aggregates client-reported playback telemetry into status(), guarding against double-counts and stale/unknown events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    const request = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/status")) return new Response(JSON.stringify({ players: [{ player_id: "one", connected: true, flagged: false, listeners: 1 }] }), { status: 200 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "secret", publicUrl: "https://audio.test" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });

    audio.recordEvent("one", "connecting", 1000);
    audio.recordEvent("one", "playing", 1200);
    audio.recordEvent("one", "reconnecting", 5000);
    audio.recordEvent("one", "playing", 6500); // Recovered 1.5s after the stall was first reported.
    let status = await audio.status() as { players: Array<Record<string, unknown>> };
    expect(status.players[0]).toMatchObject({ playbackState: "playing", reconnects: 1, lastRecoveryMs: 1500 });

    audio.recordEvent("one", "reconnecting", 7000);
    audio.recordEvent("one", "reconnecting", 7200); // Repeated native events for one stall must not double-count.
    status = await audio.status() as { players: Array<Record<string, unknown>> };
    expect(status.players[0]).toMatchObject({ reconnects: 2 });

    audio.recordEvent("one", "playing", 6900); // Out-of-order delivery: ignored, does not clear the open stall.
    status = await audio.status() as { players: Array<Record<string, unknown>> };
    expect(status.players[0]).toMatchObject({ playbackState: "reconnecting", reconnects: 2 });

    audio.recordEvent("one", "connecting", 7300); // A new transport may buffer before recovery.
    audio.recordEvent("one", "playing", 8000);
    status = await audio.status() as { players: Array<Record<string, unknown>> };
    expect(status.players[0]).toMatchObject({ reconnects: 2, lastRecoveryMs: 1000 });

    audio.recordEvent("gone", "reconnecting", 8000); // Never-registered participant leaves no trace.
    status = await audio.status() as { players: Array<Record<string, unknown>> };
    expect(status.players.find((p) => p.player_id === "gone")).toBeUndefined();

    await audio.stop();
  });

  it("reports telemetry age using server receipt time and ignores out-of-order refreshes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    const request = vi.fn(async () => new Response(JSON.stringify({ players: [{ player_id: "one" }] }))) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "secret", publicUrl: "https://audio.test" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });
    const clock = vi.spyOn(Date, "now").mockReturnValue(100000);
    try {
      audio.recordEvent("one", "playing", 999999999); // Phone clock may differ.
      clock.mockReturnValue(105000);
      audio.recordEvent("one", "paused", 100); // Ignored; must not refresh the age.
      expect(await audio.status()).toMatchObject({ players: [{ playbackState: "playing", phoneReportAgeMs: 5000 }] });
    } finally { clock.mockRestore(); await audio.stop(); }
  });

  it("live-switches to a healthy local backend, replays current narration there, and notifies connected phones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    await writeFile(join(dir, "voice.mp3"), "voice");
    const calls: string[] = [];
    const request = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      calls.push(value);
      if (value.endsWith("/health")) return new Response("{}", { status: 200 });
      if (value.endsWith("/status")) return new Response('{"players":[]}', { status: 200 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const notified: Array<{ id: string; url: string }> = [];
    const audio = new PersonalAudio(
      { url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request,
      (clientId, streamUrl) => notified.push({ id: clientId, url: streamUrl }),
    );
    await audio.register({ clientId: "one", name: "One" });
    audio.transition(phase("voice.mp3"));
    await audio.register({ clientId: "one", name: "One" });
    notified.length = 0;

    const result = await audio.setBackend({ kind: "local", config: { url: "http://local-bridge", token: "local-secret", publicUrl: "http://192.168.1.42:8300" }, label: "Stage LAN" });

    expect(result).toEqual({ ok: true });
    expect((await audio.status() as { backend: string; backendLabel: string }).backend).toBe("local");
    expect((await audio.status() as { backend: string; backendLabel: string }).backendLabel).toBe("Stage LAN");
    expect(calls).toContain("http://local-bridge/health");
    expect(calls.some((call) => call.startsWith("http://local-bridge/players/one/play"))).toBe(true);
    expect(notified).toEqual([{ id: "one", url: "http://192.168.1.42:8300/stream/one" }]);
    await audio.stop();
  });

  it("does not switch backends when the target's health check fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    const request = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/health")) return new Response("down", { status: 503 });
      return new Response('{"players":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });

    const result = await audio.setBackend({ kind: "local", config: { url: "http://local-bridge", token: "x", publicUrl: "http://192.168.1.42:8300" }, label: "Stage LAN" });

    expect(result.ok).toBe(false);
    expect((await audio.status() as { backend: string }).backend).toBe("remote");
    expect(await audio.register({ clientId: "one", name: "One" })).toBe("https://audio.example/stream/one");
    await audio.stop();
  });

  it("switches back to the remote backend without needing the caller to re-supply its config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
    const request = vi.fn(async () => new Response('{"players":[]}', { status: 200 })) as unknown as typeof fetch;
    const audio = new PersonalAudio({ url: "http://bridge", token: "secret", publicUrl: "https://audio.example" }, dir, vi.fn(), request);
    await audio.register({ clientId: "one", name: "One" });
    await audio.setBackend({ kind: "local", config: { url: "http://local-bridge", token: "x", publicUrl: "http://192.168.1.42:8300" }, label: "Stage LAN" });

    const result = await audio.setBackend({ kind: "remote" });

    expect(result).toEqual({ ok: true });
    expect((await audio.status() as { backend: string }).backend).toBe("remote");
    expect(await audio.register({ clientId: "one", name: "One" })).toBe("https://audio.example/stream/one");
    await audio.stop();
  });
});


it("silences stream injection for synchronized scenes and restores ordinary narration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "phone-audio-sync-"));
  await writeFile(join(dir, "voice.mp3"), "voice");
  const request = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
  const audio = new PersonalAudio({ url: "http://bridge", token: "x", publicUrl: "http://audio" }, dir, vi.fn(), request);
  await audio.register({ clientId: "one", name: "One" });
  audio.transition({ kind: "video", id: "video", src: "video.mp4", expectedDurationMs: 1000, next: "idle", phoneAudioMode: "synchronized", phoneAudioSrc: "voice.mp3" });
  await audio.register({ clientId: "one", name: "One" });
  expect(vi.mocked(request).mock.calls.some(([url]) => String(url).endsWith("/play"))).toBe(false);
  audio.transition(phase("voice.mp3"));
  await audio.register({ clientId: "one", name: "One" });
  expect(vi.mocked(request).mock.calls.some(([url]) => String(url).endsWith("/play"))).toBe(true);
  await audio.stop();
});


it("uploads background music, preserves it across narration and backend changes, and stops it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "music-"));
  await writeFile(join(dir, "music.mp3"), "music");
  const calls: Array<{ url: string; body: any }> = [];
  const request = vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const audio = new PersonalAudio({ url: "http://bridge", token: "x", publicUrl: "http://audio" }, dir, vi.fn(), request);
  await audio.setMusic("music.mp3", 0.25);
  expect(audio.backgroundMusic).toEqual({ src: "music.mp3", volume: 0.25 });
  await audio.register({ clientId: "late", name: "Late" });
  audio.transition(phase());
  await audio.register({ clientId: "late", name: "Late" });
  expect(calls.filter(c => c.url.endsWith("/music"))).toHaveLength(1);
  await audio.setBackend({ kind: "local", label: "Local", config: { url: "http://local", token: "x", publicUrl: "http://local" } });
  expect(calls.find(c => c.url === "http://local/music")?.body).toMatchObject({ volume: 0.25 });
  await audio.setMusic(null);
  expect(calls.at(-1)?.body.file).toBeNull();
  expect(audio.backgroundMusic).toBeNull();
  await audio.stop();
});

it("holds registration until a participant's delayed reset and play finish without resetting other groups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "phone-audio-"));
  await writeFile(join(dir, "voice.mp3"), "voice");
  let hold = false;
  const pending = new Map<string, () => void>();
  const calls: string[] = [];
  const request = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    calls.push(path);
    if (hold && (path.endsWith("/one/reset") || path.endsWith("/one/play"))) {
      await new Promise<void>(resolve => pending.set(path.endsWith("/reset") ? "reset" : "play", resolve));
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const audio = new PersonalAudio({ url: "http://bridge", token: "x", publicUrl: "http://audio" }, dir, vi.fn(), request);
  await audio.register({ clientId: "one", name: "One" });
  await audio.register({ clientId: "two", name: "Two" });
  audio.transition(phase());
  await audio.register({ clientId: "one", name: "One" });
  calls.length = 0;
  hold = true;
  audio.transitionParticipants(["one"], phase("voice.mp3"));
  let ready = false;
  const registration = audio.register({ clientId: "one", name: "One" }).then(url => { ready = true; return url; });
  await vi.waitFor(() => expect(pending.has("reset")).toBe(true));
  expect(ready).toBe(false);
  pending.get("reset")!();
  await vi.waitFor(() => expect(pending.has("play")).toBe(true));
  expect(ready).toBe(false);
  pending.get("play")!();
  expect(await registration).toBe("http://audio/stream/one");
  expect(calls.some(path => path.includes("/two/"))).toBe(false);
  expect(calls.filter(path => path.endsWith("/one/play"))).toHaveLength(1);
  await audio.stop();
});

it('retries failed mount revocations without skipping other participants', async () => {
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}'));
  const audio = new PersonalAudio({ url: 'http://bridge', token: 'x', publicUrl: 'http://audio' }, '/tmp', vi.fn(), request as typeof fetch);
  await audio.register({ clientId: 'one', name: 'One' });
  await audio.register({ clientId: 'two', name: 'Two' });
  let failOne = true;
  request.mockImplementation(async (url, init) => new Response('{}', { status: init?.method === 'DELETE' && String(url).endsWith('/one') && failOne ? 503 : 200 }));
  audio.endSession();
  // Registration is a queue barrier and also retries its own pending release.
  await expect(audio.register({ clientId: 'one', name: 'One' })).rejects.toThrow();
  expect(request.mock.calls.some(([url, init]) => String(url).endsWith('/two') && init?.method === 'DELETE')).toBe(true);
  failOne = false;
  await audio.register({ clientId: 'one', name: 'One' });
  expect(request.mock.calls.filter(([url, init]) => String(url).endsWith('/one') && init?.method === 'DELETE').length).toBeGreaterThanOrEqual(2);
  await audio.stop();
});

it('restores the current cue after a source epoch changes without replaying healthy registrations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'janus-epoch-'));
  await writeFile(join(dir, 'voice.mp3'), 'voice');
  let epoch = 'first';
  const request = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/active') ? { sourceEpoch: epoch } : {})));
  const audio = new PersonalAudio({ url: 'http://bridge', token: 'x', publicUrl: 'http://audio' }, dir, vi.fn(), request as typeof fetch);
  audio.transition(phase('voice.mp3'), () => null, Date.now() - 1000);
  await audio.register({ clientId: 'one', name: 'One' });
  await audio.register({ clientId: 'one', name: 'One' });
  expect(request.mock.calls.filter(([url]) => String(url).endsWith('/play'))).toHaveLength(1);
  epoch = 'restarted';
  await audio.register({ clientId: 'one', name: 'One' });
  expect(request.mock.calls.filter(([url]) => String(url).endsWith('/play'))).toHaveLength(2);
  await audio.stop();
});

it('restores configured music when the first source appears after an idle mixer restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'janus-music-'));
  await writeFile(join(dir, 'music.mp3'), 'music');
  const request = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/active') ? { sourceEpoch: 'new-mixer' } : {})));
  const audio = new PersonalAudio({ url: 'http://bridge', token: 'x', publicUrl: 'http://audio' }, dir, vi.fn(), request as typeof fetch);
  await audio.setMusic('music.mp3', 0.2);
  await audio.register({ clientId: 'one', name: 'One' });
  await (audio as unknown as { reconcile(): Promise<void> }).reconcile();
  expect(request.mock.calls.filter(([url]) => String(url).endsWith('/music'))).toHaveLength(2);
  await (audio as unknown as { reconcile(): Promise<void> }).reconcile();
  expect(request.mock.calls.filter(([url]) => String(url).endsWith('/music'))).toHaveLength(2);
  await audio.stop();
});
