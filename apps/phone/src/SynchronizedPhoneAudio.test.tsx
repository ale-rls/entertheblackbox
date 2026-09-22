// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ServerClock } from "@entertheblackbox/shared";
import { SynchronizedPhoneAudio } from "./SynchronizedPhoneAudio";

it("keeps the synchronized prompt scoped to the active cue, despite a nonempty catalogue", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ["other-group.mp3"], arrayBuffer: async () => new ArrayBuffer(1) })));
  const host = document.createElement("div");
  const root = createRoot(host);
  const clock = new ServerClock();
  try {
    await act(async () => root.render(<SynchronizedPhoneAudio clock={clock} cue={null} />));
    expect(host.querySelector("section")).toBeNull();
    await act(async () => root.render(<SynchronizedPhoneAudio clock={clock} cue={{ key: "scene", src: "other-group.mp3", startedAt: 0, endsAt: 1000 }} />));
    expect(host.textContent).toContain("Enable synchronized audio");
    await act(async () => root.render(<SynchronizedPhoneAudio clock={clock} cue={null} />));
    expect(host.querySelector("section")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
