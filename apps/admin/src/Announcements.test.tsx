// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Announcements, announcementError } from "./Announcements.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("announcementError", () => {
  it("explains the server's refusals in operator words", () => {
    expect(announcementError(401, null)).toBe("Operator sign-in expired.");
    expect(announcementError(503, { error: "voice_unavailable" })).toContain("ELEVENLABS_API_KEY");
    expect(announcementError(502, { error: "voice_failed", message: "ElevenLabs 429: quota" })).toBe("The voice service failed: ElevenLabs 429: quota");
    expect(announcementError(500, null)).toBe("Request failed (500).");
  });
});

describe("Announcements panel", () => {
  let root: Root | null = null;
  afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };

  it("lists saved clips, generates and plays a new one, and replays a saved one", async () => {
    const now = Date.now();
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
      calls.push({ url: input, method: init.method ?? "GET", ...(init.body ? { body: String(init.body) } : {}) });
      if (input === "/api/admin/announcements" && (init.method ?? "GET") === "GET") return json({ clips: [{ id: "old", text: "Gleich geht es weiter.", durationMs: 3_000, createdAt: "x" }], canGenerate: true, playing: null, serverNow: now });
      if (input === "/api/admin/announcements") return json({ ok: true, clip: { id: "new", text: "Noch einen Moment.", durationMs: 2_000, createdAt: "y" } });
      if (input.endsWith("/play")) return json({ ok: true, delivered: true, playing: { id: input.split("/")[4], startedAt: now, durationMs: 2_000 }, serverNow: now });
      return json({ error: "unexpected" }, 500);
    }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Announcements token="operator" />));
    await flush();
    expect(host.textContent).toContain("Gleich geht es weiter.");

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Noch einen Moment.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const generate = [...host.querySelectorAll("button")].find((button) => button.textContent === "Generate & play")!;
    await act(async () => generate.click());
    await flush();
    expect(calls.find((call) => call.method === "POST" && call.url === "/api/admin/announcements")?.body).toBe(JSON.stringify({ text: "Noch einen Moment." }));
    expect(calls.some((call) => call.url === "/api/admin/announcements/new/play")).toBe(true);
    expect(host.textContent).toContain("Stop ·");
    expect(textarea.value).toBe("");

    const replay = host.querySelector<HTMLButtonElement>('button[aria-label="Play: Gleich geht es weiter."]')!;
    await act(async () => replay.click());
    await flush();
    expect(calls.some((call) => call.url === "/api/admin/announcements/old/play")).toBe(true);
  });

  it("keeps saved clips playable when the server cannot generate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ clips: [], canGenerate: false, playing: null, serverNow: Date.now() })));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Announcements token="operator" />));
    await flush();
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    expect(host.querySelector("textarea")!.placeholder).toContain("not set up");
  });
});
