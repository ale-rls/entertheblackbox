// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
import { useDisplaySettings } from "./useDisplaySettings.js";
it("updates live and retains last-good text through invalid responses and outages", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = vi.fn().mockResolvedValueOnce(Response.json({ ...DEFAULT_DISPLAY_SETTINGS, heading: "Welcome" }))
    .mockResolvedValueOnce(Response.json({ bad: true })).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({ ...DEFAULT_DISPLAY_SETTINGS, heading: "Hallo" }));
  vi.stubGlobal("fetch", request);
  const host = document.createElement("div"); const root = createRoot(host);
  function Probe() { return <p>{useDisplaySettings().heading}</p>; }
  try {
    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe("Welcome");
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(host.textContent).toBe("Welcome");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(host.textContent).toBe("Hallo");
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
