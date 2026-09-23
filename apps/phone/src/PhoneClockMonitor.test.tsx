// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ServerClock } from "@entertheblackbox/shared";
import { PhoneClockMonitor, phoneTiming } from "./PhoneClockMonitor.js";
import { initialPhoneState } from "./state/store.js";
import type { PhoneConnection } from "./lib/connection.js";
it("reports current phone routing and stops reporting after unmount", async () => {
  vi.useFakeTimers(); vi.setSystemTime(10000); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const clock = new ServerClock(); clock.addSample(10000, 10000, 11000);
  const send = vi.fn(); const connection = { clock, send } as unknown as PhoneConnection;
  const state = { ...initialPhoneState, sessionId: "s", currentPhaseId: "film", phaseEpoch: 3, routingEpoch: 2, phoneAudioActive: true, join: { kind: "accepted", identity: {} } } as typeof initialPhoneState;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<PhoneClockMonitor connection={connection} state={state} timingRef={{ current: null }} />));
    expect(host.textContent).toContain("cue drift is not measurable");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: "ping", timing: expect.objectContaining({ phaseEpoch: 3, routingEpoch: 2, timing: expect.objectContaining({ mode: "stream", media: [] }) }) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(send).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    await vi.advanceTimersByTimeAsync(2000); expect(send).toHaveBeenCalledTimes(2);
    const synchronized = { ...state, synchronizedPhase: { kind: "video" } } as typeof state;
    expect(phoneTiming(connection, synchronized, () => ({ cueKey: "old", media: [] })).media[0]?.state).toBe("loading");
  } finally { host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
