// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { MonitorBackgrounds } from "./MonitorBackgrounds.js";

let root: Root | null = null;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("sets, replaces and clears live monitor backgrounds through the admin API", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    return new Response(JSON.stringify({ ok: true, colors: body.colors, delivered: 4 }), { status: 200 });
  }));
  const onChange = vi.fn();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(<MonitorBackgrounds token="t" colors={{ M1: "#30a46c" }} onChange={onChange} />));

  expect(document.querySelector('[aria-label="M1 Green"]')?.getAttribute("aria-checked")).toBe("true");
  await act(async () => (document.querySelector('[aria-label="M3 Orange"]') as HTMLButtonElement).click());
  expect(bodies.at(-1)).toEqual({ colors: { M1: "#30a46c", M3: "#f76b15" } });
  expect(onChange).toHaveBeenLastCalledWith({ M1: "#30a46c", M3: "#f76b15" });

  const sceneButtons = [...document.querySelectorAll("button")].filter((button) => button.textContent === "Scene");
  await act(async () => sceneButtons[0]!.click());
  expect(bodies.at(-1)).toEqual({ colors: {} });

  await act(async () => ([...document.querySelectorAll("button")].find((button) => button.textContent === "Clear all") as HTMLButtonElement).click());
  expect(bodies.at(-1)).toEqual({ colors: {} });
});
