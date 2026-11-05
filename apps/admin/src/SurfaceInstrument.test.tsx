// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Status } from "./App.js";
import { byLabel, duplicateLabels, SurfaceInstrument, TAP_HOLD_MS } from "./SurfaceInstrument.js";

const person = (clientId: string, name: string, connected = true): Status["participants"][number] =>
  ({ clientId, name, color: "#ffffff", connected, joinedAt: 0, lastSeenAt: 0 });
const pointer = (type: string, target: Element) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));

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
});
