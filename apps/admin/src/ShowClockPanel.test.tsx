// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerClock } from "@entertheblackbox/shared";
import type { TimingMonitor } from "@entertheblackbox/protocol";
import { ShowClockPanel, timingHealth } from "./ShowClockPanel.js";
import type { Status } from "./App.js";
const row: TimingMonitor = { id: "display:main", label: "Main display", kind: "display", phaseId: "film", phaseEpoch: 1, connected: true, mediaExpected: true, reportAgeMs: 100,
  timing: { calibrated: true, offsetMs: 500, roundTripMs: 10, sampleAgeMs: 200, elapsedMs: 5000, mode: "display", media: [{ role: "main", positionMs: 4900, targetMs: 5000, driftMs: -100, state: "playing" }] } };
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("distinguishes drift, missing reports, stale clocks, and unmeasurable streams", () => {
  expect(timingHealth(row, 0, false).label).toBe("Within tolerance");
  expect(timingHealth(row, 6000, false).label).toBe("Report stale");
  expect(timingHealth({ ...row, connected: false }, 0, false).label).toBe("Disconnected");
  expect(timingHealth({ ...row, timing: null }, 0, false).label).toBe("Awaiting report");
  expect(timingHealth({ ...row, timing: { ...row.timing!, mode: "stream", media: [] } }, 0, false).label).toBe("Stream drift unmeasured");
  expect(timingHealth({ ...row, timing: { ...row.timing!, media: [{ ...row.timing!.media[0]!, driftMs: 400 }] } }, 0, false).label).toBe("Out of sync");
  expect(timingHealth({ ...row, timing: { ...row.timing!, sampleAgeMs: 31000 } }, 0, false).label).toBe("Clock stale");
});
it("renders measured device data, filters phones, and marks stopped polling stale", async () => {
  const clock = new ServerClock(); clock.addSample(10000, 10000, 11000);
  const phone = { ...row, id: "phone:p", kind: "phone" as const, label: "Rehearsal phone", timing: { ...row.timing!, mode: "stream" as const, media: [] } };
  const status = { groupPaths: [], timingMonitors: [row, phone] } as unknown as Status;
  await act(async () => root.render(<ShowClockPanel clock={clock} status={status} stale={false} receivedAt={10000} />));
  expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe("show-clock-heading");
  expect(host.textContent).toContain("4.90 / 5.00 s"); expect(host.textContent).toContain("-100 ms");
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "phone"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).not.toContain("Main display"); expect(host.textContent).toContain("Rehearsal phone");
  await act(async () => { await vi.advanceTimersByTimeAsync(6250); });
  expect(host.textContent).toContain("Updates stale");
  expect(host.querySelector("tbody")?.textContent).not.toContain("Within tolerance");
});
