// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WALL_LAYOUT } from "@entertheblackbox/shared";
import { slotState, sliceSheetCsv, VideoWall, type WallSnapshot } from "./VideoWall.js";

const layout = { ...DEFAULT_WALL_LAYOUT, cols: 2, rows: 1, slots: { A1: "T01" } };
const snapshot = (overrides: Partial<WallSnapshot> = {}): WallSnapshot => ({
  layout,
  state: { clip: null, startAt: null, loop: true },
  devices: [
    { clientId: "c1", name: "T01", slot: "A1", connected: true },
    { clientId: "c2", name: "T02", slot: null, connected: true },
  ],
  serverNow: 0,
  clips: [{ id: "ocean", kind: "sliced", slices: { A1: { src: "ocean__A1.mp4", bytes: 1 } } }, { id: "intro.mp4", kind: "whole", file: { src: "intro.mp4", bytes: 2 } }],
  ...overrides,
});

describe("wall helpers", () => {
  it("summarises each position for the operator", () => {
    const device = { clientId: "c", name: "T01", slot: "A1", connected: true };
    expect(slotState(undefined, "ocean")).toMatchObject({ text: "No tablet", tone: "warning" });
    expect(slotState({ ...device, connected: false }, "ocean")).toMatchObject({ text: "Offline", tone: "danger" });
    expect(slotState(device, "ocean")).toMatchObject({ text: "Waiting for tablet" });
    expect(slotState({ ...device, status: { clip: "ocean", state: "ready", detail: "Not in show mode", at: 0 } }, "ocean")).toMatchObject({ text: "Not in show mode", tone: "warning" });
    expect(slotState({ ...device, status: { clip: "ocean", state: "playing", driftMs: -12, at: 0 } }, "ocean")).toMatchObject({ text: "Playing -12 ms", tone: "success" });
    expect(slotState({ ...device, status: { clip: "ocean", state: "playing", driftMs: 240, at: 0 } }, "ocean").tone).toBe("warning");
  });

  it("writes a slice sheet with Premiere values and file names", () => {
    const csv = sliceSheetCsv(layout, "ocean").trim().split("\n");
    expect(csv[0]).toContain("premiere_scale_pct");
    expect(csv).toHaveLength(3);
    expect(csv[1]).toMatch(/^A1,T01,.*,ocean__A1\.mp4$/);
    expect(csv[2]).toMatch(/^A2,,/);
  });
});

describe("VideoWall", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let request: ReturnType<typeof vi.fn>;
  let current: WallSnapshot;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    current = snapshot();
    request = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return Response.json(current);
      return Response.json({ ok: true, delivered: 2 });
    });
    vi.stubGlobal("fetch", request);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const render = async () => { await act(async () => root.render(<VideoWall token="operator" />)); await act(async () => {}); };
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
  const posts = () => request.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST").map(([url, init]) => [url, JSON.parse(String((init as RequestInit).body))]);

  it("loads and plays a clip, and lists missing slices", async () => {
    await render();
    expect(host.textContent).toContain("ocean (1/2 positions)");
    expect(host.textContent).toContain("ocean has no slice for A2");
    expect(button("Play").disabled).toBe(true);
    current = snapshot({ state: { clip: "ocean", startAt: null, loop: true } });
    await act(async () => { button("Load on tablets").click(); });
    expect(posts()[0]).toEqual(["/api/admin/wall", { action: "load", clip: "ocean" }]);
    expect(host.textContent).toContain("Loaded ocean · sent to 2 tablets");
    expect(button("Reload")).toBeTruthy();
    await act(async () => { button("Play").click(); });
    expect(posts().at(-1)).toEqual(["/api/admin/wall", { action: "play" }]);
    expect(request.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: "Bearer operator" } });
  });

  it("assigns connected tablets in label order and saves the layout", async () => {
    await render();
    await act(async () => { button("Fill in label order").click(); });
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Tablet at A2"]')!.value).toBe("T02");
    await act(async () => { button("Save layout").click(); });
    const put = request.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")!;
    expect(put[0]).toBe("/api/admin/wall/layout");
    expect(JSON.parse(String((put[1] as RequestInit).body)).slots).toEqual({ A1: "T01", A2: "T02" });
  });

  it("recomputes the slice table as the layout is edited", async () => {
    await render();
    expect(host.querySelectorAll(".video-wall-table tbody tr")).toHaveLength(2);
    const rows = [...host.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.textContent?.startsWith("Rows"))!.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(rows, "2");
      rows.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll(".video-wall-table tbody tr")).toHaveLength(4);
    expect(host.textContent).toContain("ocean__B2.mp4");
    expect(button("Save layout").disabled).toBe(false);
  });

  it("offers uncut videos, which need no slices", async () => {
    await render();
    expect([...host.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(["Pre-cut slices", "Whole video (cut on the tablets)"]);
    const select = host.querySelector<HTMLSelectElement>("select.sc-tool-field")!;
    await act(async () => { select.value = "intro.mp4"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.textContent).toContain("every tablet downloads the full file");
    expect(host.textContent).not.toContain("has no slice");
    await act(async () => { button("Load on tablets").click(); });
    expect(posts()[0]).toEqual(["/api/admin/wall", { action: "load", clip: "intro.mp4" }]);
  });

  it("takes the master size from the reference video so crops match the real file", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:reference", revokeObjectURL: () => {} }));
    await render();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["x"], "small.mp4", { type: "video/mp4" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    const video = host.querySelector<HTMLVideoElement>(".video-wall-preview video")!;
    Object.defineProperty(video, "videoWidth", { value: 1280 });
    Object.defineProperty(video, "videoHeight", { value: 720 });
    await act(async () => { video.dispatchEvent(new Event("loadedmetadata")); });
    const field = (name: string) => [...host.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.textContent?.startsWith(name))!.querySelector("input")!.value;
    expect([field("Master width"), field("Master height")]).toEqual(["1280", "720"]);
    expect(button("Save layout").disabled).toBe(false);
  });
});
