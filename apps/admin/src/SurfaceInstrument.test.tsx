// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Status } from "./App.js";
import { byLabel, duplicateLabels, keyHint, SurfaceInstrument, TABLET_KEY_CODES, TAP_HOLD_MS } from "./SurfaceInstrument.js";

const person = (clientId: string, name: string, connected = true): Status["participants"][number] =>
  ({ clientId, name, color: "#ffffff", connected, joinedAt: 0, lastSeenAt: 0 });
const pointer = (type: string, target: Element, pointerId?: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  if (pointerId !== undefined) Object.defineProperty(event, "pointerId", { value: pointerId });
  return target.dispatchEvent(event);
};
const key = (type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...init }));

describe("tablet ordering and labels", () => {
  it("sorts labels naturally and flags duplicates among connected tablets", () => {
    expect([person("a", "T10"), person("b", "T2"), person("c", "T1")].sort(byLabel).map((p) => p.name)).toEqual(["T1", "T2", "T10"]);
    expect([...duplicateLabels([person("a", "T07"), person("b", "t07"), person("c", "T08"), person("d", "T08", false)])]).toEqual(["t07"]);
  });
});

describe("SurfaceInstrument", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let request: ReturnType<typeof vi.fn>;
  const bodies = () => request.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    request = vi.fn(async () => Response.json({ ok: true, delivered: 1 }));
    vi.stubGlobal("fetch", request);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  const render = async () => act(async () => root.render(<SurfaceInstrument token="operator" participants={[person("b", "T10"), person("a", "T2"), person("z", "T3", false)]} />));
  const tile = (name: string) => [...host.querySelectorAll<HTMLElement>(".surface-tile")].find((el) => el.querySelector("strong")?.textContent === name)!;

  it("renders tablets in label order and dims disconnected ones", async () => {
    await render();
    expect([...host.querySelectorAll(".surface-tile strong")].map((el) => el.textContent)).toEqual(["All tablets", "T2", "T3", "T10"]);
    expect(tile("T3").classList.contains("is-disconnected")).toBe(true);
    expect([...host.querySelectorAll(".surface-tile .surface-key")].map((el) => el.textContent)).toEqual(["Space", "1", "2", "3"]);
  });

  it("holds while pressed, releases on lift, and keeps a quick tap lit for the tap hold", async () => {
    await render();
    await act(async () => { pointer("pointerdown", tile("T2")); });
    expect(bodies()[0]).toEqual({ target: ["a"], mode: "flash", color: "#ff2d2d" });
    expect(tile("T2").style.backgroundColor).not.toBe("");
    await act(async () => { pointer("pointerup", tile("T2")); });
    expect(bodies()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(TAP_HOLD_MS); });
    expect(bodies()[1]).toEqual({ target: ["a"], mode: "release" });

    await act(async () => { pointer("pointerdown", tile("T10")); });
    await act(async () => { vi.advanceTimersByTime(500); pointer("pointerup", tile("T10")); });
    expect(bodies().at(-1)).toEqual({ target: ["b"], mode: "release" });
  });

  it("plays tiles in turn while dragging across them", async () => {
    await render();
    const t10 = tile("T10");
    vi.stubGlobal("document", Object.assign(document, { elementFromPoint: () => t10 }));
    await act(async () => { pointer("pointerdown", tile("T2")); });
    await act(async () => { vi.advanceTimersByTime(400); pointer("pointermove", tile("T2")); });
    expect(bodies().slice(1)).toEqual([{ target: ["a"], mode: "release" }, { target: ["b"], mode: "flash", color: "#ff2d2d" }]);
  });

  it("addresses every tablet from the All pad and identifies a single tablet", async () => {
    await render();
    await act(async () => { host.querySelector<HTMLButtonElement>('[role="radio"][aria-label="#00c2ff"]')!.click(); });
    await act(async () => { pointer("pointerdown", host.querySelector(".surface-tile-all")!); });
    expect(bodies()[0]).toEqual({ target: "all", mode: "flash", color: "#00c2ff" });
    await act(async () => { pointer("pointerup", host.querySelector(".surface-tile-all")!); vi.advanceTimersByTime(TAP_HOLD_MS); });
    await act(async () => { tile("T10").querySelector<HTMLButtonElement>("[data-surface-identify]")!.click(); });
    expect(bodies().at(-1)).toEqual({ target: ["b"], mode: "identify" });
    expect(request.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: "Bearer operator" } });
  });

  it("does not let a tap's delayed release cut off a fresh press of the same tablet", async () => {
    await render();
    await act(async () => { pointer("pointerdown", tile("T2")); pointer("pointerup", tile("T2")); });
    await act(async () => { vi.advanceTimersByTime(50); pointer("pointerdown", tile("T2")); });
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(bodies().map((body) => body.mode)).toEqual(["flash", "flash"]);
    await act(async () => { pointer("pointerup", tile("T2")); });
    expect(bodies().at(-1)).toEqual({ target: ["a"], mode: "release" });
  });

  it("plays chords from the keyboard and from several pointers, releasing each tablet on its own", async () => {
    await render();
    await act(async () => { key("keydown", "Digit1"); key("keydown", "Digit3"); key("keydown", "Digit2"); });
    // Digit2 is the disconnected T3: ignored.
    expect(bodies()).toEqual([{ target: ["a"], mode: "flash", color: "#ff2d2d" }, { target: ["b"], mode: "flash", color: "#ff2d2d" }]);
    await act(async () => { vi.advanceTimersByTime(400); key("keyup", "Digit1"); });
    expect(bodies().at(-1)).toEqual({ target: ["a"], mode: "release" });
    await act(async () => { key("keyup", "Digit3"); });
    expect(bodies().at(-1)).toEqual({ target: ["b"], mode: "release" });

    await act(async () => { pointer("pointerdown", tile("T2"), 1); pointer("pointerdown", tile("T10"), 2); });
    expect(bodies().slice(-2).map((body) => body.target)).toEqual([["a"], ["b"]]);
    await act(async () => { key("keydown", "Space"); });
    expect(bodies().at(-1)).toEqual({ target: "all", mode: "flash", color: "#ff2d2d" });
    expect(TABLET_KEY_CODES).toHaveLength(40);
    expect(keyHint("Semicolon")).toBe(";");
  });

  it("recolours held tablets at once when the colour or dimmer changes", async () => {
    await render();
    await act(async () => { key("keydown", "Digit1"); });
    await act(async () => { key("keydown", "Digit6", { shiftKey: true }); });
    expect(bodies().at(-1)).toEqual({ target: ["a"], mode: "flash", color: "#00c2ff" });
    await act(async () => { key("keydown", "ArrowDown"); });
    expect(bodies().at(-1)).toEqual({ target: ["a"], mode: "flash", color: "#00afe6" });
    await act(async () => { key("keydown", "ArrowRight"); });
    expect(bodies().at(-1)!.target).toEqual(["a"]);
  });

  it("latches tablets on a tap and toggles them off on the next", async () => {
    await render();
    await act(async () => { host.querySelector<HTMLInputElement>(".surface-toggles input")!.click(); });
    await act(async () => { pointer("pointerdown", tile("T2")); pointer("pointerup", tile("T2")); vi.advanceTimersByTime(1_000); });
    expect(bodies()).toEqual([{ target: ["a"], mode: "flash", color: "#ff2d2d" }]);
    await act(async () => { pointer("pointerdown", tile("T2")); pointer("pointerup", tile("T2")); });
    expect(bodies().at(-1)).toEqual({ target: ["a"], mode: "release" });
  });

  it("starts a server effect in label order, previews it on the tiles, and stops it with Escape", async () => {
    request.mockImplementation(async (url: string) => Response.json(url.endsWith("/effect")
      ? { ok: true, delivered: 2, running: { startedAt: Date.now() }, serverNow: Date.now() } : { ok: true, delivered: 1 }));
    await render();
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>(".surface-effect-kinds button")].find((b) => b.textContent === "Rainbow")!.click(); });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Start effect")!.click(); });
    expect(request.mock.calls[0]![0]).toBe("/api/admin/surface/effect");
    expect(bodies()[0]).toEqual({ action: "start", order: ["a", "b"], effect: { kind: "rainbow", color: "#ff2d2d", color2: "#00c2ff", periodMs: 2_000, brightness: 1 } });
    expect(tile("T2").style.backgroundColor).toBe("rgb(255, 0, 0)");
    await act(async () => { key("keydown", "Escape"); });
    expect(bodies().slice(-2)).toEqual([{ action: "stop" }, { target: "all", mode: "release" }]);
    expect(tile("T2").style.backgroundColor).toBe("");
  });
});
