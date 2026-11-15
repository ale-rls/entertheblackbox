// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MusicPanel, musicStatusText, type MusicSnapshot } from "./MusicPanel.js";

const snapshot = (overrides: Partial<MusicSnapshot> = {}): MusicSnapshot => ({
  track: null, loop: true, volume: 0, targetVolume: 0, fadingOut: false, source: null, phaseId: null, displayConnected: true,
  tracks: [{ src: "Ambient Chords.mp3", bytes: 10 }, { src: "pulse.mp3", bytes: 20 }], ...overrides,
});

describe("musicStatusText", () => {
  it("says what is playing, how loud, and where it came from", () => {
    expect(musicStatusText(snapshot())).toBe("No music");
    expect(musicStatusText(snapshot({ track: "pulse.mp3", volume: 0.6, source: "scene", phaseId: "K5-1" }))).toBe("pulse.mp3 · 60% · cue from K5-1");
    expect(musicStatusText(snapshot({ track: "pulse.mp3", volume: 0.3, source: "admin", fadingOut: true }))).toBe("pulse.mp3 · 30% · fading out · started in Admin");
  });
});

describe("MusicPanel", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let request: ReturnType<typeof vi.fn>;
  let current: MusicSnapshot;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    current = snapshot();
    request = vi.fn(async (_url: string, init?: RequestInit) => (!init?.method || init.method === "GET") ? Response.json(current) : Response.json({ ok: true }));
    vi.stubGlobal("fetch", request);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const render = async () => { await act(async () => root.render(<MusicPanel token="operator" />)); await act(async () => {}); };
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
  const posts = () => request.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST").map(([url, init]) => [url, JSON.parse(String((init as RequestInit).body))]);

  it("plays a library track and fades it out", async () => {
    await render();
    expect(host.textContent).toContain("No music");
    expect(button("Fade out").disabled).toBe(true);
    expect(button("Play").disabled).toBe(true);
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "pulse.mp3"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    current = snapshot({ track: "pulse.mp3", volume: 1, source: "admin" });
    await act(async () => { button("Play").click(); });
    expect(posts()[0]).toEqual(["/api/admin/music", { action: "play", src: "pulse.mp3", volume: 1, loop: true, fadeMs: 1_000 }]);
    expect(host.textContent).toContain("pulse.mp3 · 100% · started in Admin");
    await act(async () => { button("Fade out").click(); });
    expect(posts().at(-1)).toEqual(["/api/admin/music", { action: "stop", fadeMs: 3_000 }]);
    expect(request.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: "Bearer operator" } });
  });
});
