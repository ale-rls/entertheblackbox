// @vitest-environment jsdom
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CursorSizes } from "./CursorSizes.js";

let root: Root | null = null;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

it("adds a scene with its own cursor size and saves it without losing other display settings", async () => {
  let stored = { ...DEFAULT_DISPLAY_SETTINGS, heading: "Kept", cursorSizeByScene: { "T1-1": 1.5 } };
  const puts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") { stored = JSON.parse(String(init.body)); puts.push(stored); }
    return new Response(JSON.stringify({ configured: true, display: stored }), { status: 200 });
  }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  const scenes = [{ id: "T1-1", title: "First vote" }, { id: "K6-2-Hack", title: "Hack", cueName: "Hack" }];
  await act(async () => root?.render(<CursorSizes token="t" scenes={scenes} currentSceneId="T1-1" />));
  await flush();

  expect(document.body.textContent).toContain("Now: 1.50× in First vote");
  const select = document.querySelector<HTMLSelectElement>('[aria-label="Scene to add"]')!;
  expect([...select.options].map((option) => option.value)).toEqual(["", "K6-2-Hack"]);
  await act(async () => { select.value = "K6-2-Hack"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => ([...document.querySelectorAll("button")].find((button) => button.textContent === "Add scene") as HTMLButtonElement).click());
  await act(async () => ([...document.querySelectorAll("button")].find((button) => button.textContent === "Save") as HTMLButtonElement).click());
  await flush();

  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({ heading: "Kept", cursorSize: 1, cursorSizeByScene: { "T1-1": 1.5, "K6-2-Hack": 2 } });
  expect(document.body.textContent).toContain("Saved.");
});
