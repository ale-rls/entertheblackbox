// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.js";
it("loads saved copy, saves edits and retains them when PocketBase fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "PUT" ? new Response("error", { status: 500 }) : Response.json({ configured: true, display: { ...DEFAULT_DISPLAY_SETTINGS, heading: "Saved heading" } }));
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
