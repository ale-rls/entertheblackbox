// @vitest-environment jsdom
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { HackCheckpoints } from "./HackCheckpoints.js";

let root: Root | null = null;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });

it("saves the checkpoint amount and keeps the other display settings", async () => {
  let stored = { ...DEFAULT_DISPLAY_SETTINGS, heading: "Kept" };
  const puts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") { stored = JSON.parse(String(init.body)); puts.push(stored); }
    return new Response(JSON.stringify({ configured: true, display: stored }), { status: 200 });
  }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(<HackCheckpoints token="t" />));
  await flush();
  const input = document.querySelector<HTMLInputElement>("input[type=number]")!;
  expect(input.value).toBe("");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "8"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
  expect(puts).toEqual([expect.objectContaining({ heading: "Kept", hackCheckpoints: 8 })]);
  expect(document.body.textContent).toContain("the hack needs 8 checkpoints");
});
