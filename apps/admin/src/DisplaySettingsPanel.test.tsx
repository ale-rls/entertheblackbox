// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.js";
it("loads saved copy, saves edits and retains them when PocketBase fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => String(_url).endsWith("waiting-videos") ? Response.json({ videos: [] }) : init?.method === "PUT" ? new Response("error", { status: 500 }) : Response.json({ configured: true, display: { ...DEFAULT_DISPLAY_SETTINGS, heading: "Saved heading" } }));
  vi.stubGlobal("fetch", request);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<DisplaySettingsPanel token="operator" />); });
    const input = host.querySelector("input")!;
    expect(input.value).toBe("Saved heading");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New heading"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(input.value).toBe("New heading");
    expect(host.textContent).toContain("Your edits are still here");
    const sent = request.mock.calls.find(([, init]) => init?.method === "PUT")![1]!;
    expect(JSON.parse(String(sent.body)).heading).toBe("New heading");
    expect(sent.headers).toMatchObject({ Authorization: "Bearer operator" });
    request.mockResolvedValueOnce(Response.json({ configured: true, display: { ...DEFAULT_DISPLAY_SETTINGS, heading: "New heading" } }));
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(host.textContent).toContain("Saved to PocketBase");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("edits separate group video overrides and submits them with the default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = vi.fn(async (url: unknown) => String(url).endsWith("waiting-videos") ? Response.json({ videos: [{ src: "red.mp4", url: "/media/red.mp4", available: true }, { src: "pending.mp4", url: "/media/pending.mp4", available: false }] }) : Response.json({ configured: true, groups: [{ id: "red", label: "Red" }, { id: "blue", label: "Blue" }], display: { ...DEFAULT_DISPLAY_SETTINGS, waitingVideoUrl: "/media/default.mp4" } }));
  vi.stubGlobal("fetch", request);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => { root.render(<DisplaySettingsPanel token="operator" />); });
    const selects = host.querySelectorAll("select");
    expect(host.querySelector<HTMLOptionElement>('option[value="/media/pending.mp4"]')!.disabled).toBe(true);
    expect(selects[0]!.textContent).toContain("Saved video (not in library)");
    await act(async () => { selects[1]!.value = "/media/red.mp4"; selects[1]!.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { selects[2]!.value = ""; selects[2]!.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const calls = request.mock.calls as unknown as [string, RequestInit][];
    const sent = calls.find(([, init]) => init?.method === "PUT")![1];
    expect(JSON.parse(String(sent.body))).toMatchObject({ waitingVideoUrl: "/media/default.mp4", groupWaitingVideoUrls: { red: "/media/red.mp4", blue: "" } });
    await act(async () => { selects[1]!.value = "inherit"; selects[1]!.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll("select")[1]!.value).toBe("inherit");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("edits the signage kiosk video override and submits it alongside the default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = vi.fn(async (url: unknown) => String(url).endsWith("waiting-videos") ? Response.json({ videos: [{ src: "lobby-qr.mp4", url: "/media/lobby-qr.mp4", available: true }] }) : Response.json({ configured: true, display: { ...DEFAULT_DISPLAY_SETTINGS, waitingVideoUrl: "/media/default.mp4" } }));
  vi.stubGlobal("fetch", request);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => { root.render(<DisplaySettingsPanel token="operator" />); });
    expect(host.textContent).toContain("Signage kiosks");
    expect(host.textContent).toContain("/display/?signage=");
    const signageSelect = Array.from(host.querySelectorAll("select")).at(-1)!;
    await act(async () => { signageSelect.value = "/media/lobby-qr.mp4"; signageSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const calls = request.mock.calls as unknown as [string, RequestInit][];
    const sent = calls.find(([, init]) => init?.method === "PUT")![1];
    expect(JSON.parse(String(sent.body))).toMatchObject({ waitingVideoUrl: "/media/default.mp4", signageVideoUrls: { lobby: "/media/lobby-qr.mp4" } });
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("keeps saved selections when the library is offline and reloads on refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let offline = true;
  const request = vi.fn(async (url: unknown) => String(url).endsWith("waiting-videos")
    ? offline ? new Response("offline", { status: 503 }) : Response.json({ videos: [{ src: "saved.mp4", url: "/media/saved.mp4", available: true }] })
    : Response.json({ configured: true, display: { ...DEFAULT_DISPLAY_SETTINGS, waitingVideoUrl: "/media/saved.mp4" } }));
  vi.stubGlobal("fetch", request);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => { root.render(<DisplaySettingsPanel token="operator" />); });
    expect(host.textContent).toContain("Could not load the media library");
    expect(host.querySelector("select")!.value).toBe("/media/saved.mp4");
    offline = false;
    await act(async () => { Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Refresh media library")!.click(); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("select")!.value).toBe("/media/saved.mp4");
    expect(host.textContent).not.toContain("Saved video (not in library)");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
