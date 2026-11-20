// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerClock } from "@entertheblackbox/shared";
import type { TimingMonitor } from "@entertheblackbox/protocol";
import type { Status } from "./App.js";
import { ShowMonitor } from "./ShowMonitor.js";
import { audioRemaining, deviceAudio, monitorGroups } from "./show-monitor-model.js";
const person = (id: string, groupId = "a") => ({ clientId: id, name: id, groupId, color: "red", connected: true, joinedAt: 0, lastSeenAt: 0, phaseId: "voice", phaseStartedAt: 1000 });
const report: TimingMonitor = { id: "phone:A01", label: "A01", kind: "phone", phaseId: "voice", phaseEpoch: 3, connected: true, mediaExpected: true, reportAgeMs: 1000,
  timing: { calibrated: true, offsetMs: 0, roundTripMs: 0, sampleAgeMs: 0, elapsedMs: 9000, mode: "synchronized", media: [{ role: "main", state: "playing", positionMs: 8000, targetMs: 8000, driftMs: 0, durationMs: 20000, src: "voice.mp3", endsAt: 40000 }] } };
const status = { participants: [person("A01"), person("B01", "b")], groups: [{ id: "a", label: "A" }, { id: "b", label: "B" }], connectedParticipants: 2,
  phaseId: "split", phaseEpoch: 2, lifecycle: "active", groupPathsStarted: true,
  groupPaths: [{ groupId: "a", label: "A", phaseId: "voice", phaseEpoch: 3, startedAt: 1000, deadlineAt: 40000, memberIds: ["A01"], done: false, state: "active" },
    { groupId: "b", label: "B", phaseId: "voice", phaseEpoch: 3, startedAt: 1000, deadlineAt: null, memberIds: ["B01"], done: true, state: "finished" }], timingMonitors: [report] } as Status;
const group = monitorGroups(status)[0]!;
const audio = (r = report, elapsed = 0, stale = false) => deviceAudio(person("A01"), group, r, elapsed, stale, 10000 + elapsed);
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("estimates clip remaining separately from the scene and respects an earlier audio stop", () => {
  expect(audio().remainingMs).toBe(11000);
  expect(audio(report, 2000).remainingMs).toBe(9000);
  const shorter = { ...report, timing: { ...report.timing!, media: [{ ...report.timing!.media[0]!, endsAt: 12000 }] } };
  expect(audio(shorter).remainingMs).toBe(2000);
});
it("never projects stale, paused, mismatched, unmeasured or old-build reports", () => {
  expect(audio(report, 6000).label).toBe("Stale");
  expect(audio(report, 0, true).remainingMs).toBeNull();
  expect(audio({ ...report, connected: false }).label).toBe("Offline");
  expect(audio({ ...report, phaseEpoch: 2 }).label).toBe("Other cue");
  expect(audio({ ...report, timing: { ...report.timing!, calibrated: false } }).remainingMs).toBeNull();
  for (const state of ["paused", "loading", "error", "waiting"] as const) expect(audio({ ...report, timing: { ...report.timing!, media: [{ ...report.timing!.media[0]!, state }] } }).remainingMs).toBeNull();
  expect(audio({ ...report, timing: { ...report.timing!, media: [{ role: "main", state: "playing", positionMs: 8000, targetMs: 8000, driftMs: 0 }] } }).remainingMs).toBeNull();
  expect(audio({ ...report, timing: { ...report.timing!, media: [] }, mediaExpected: false }).label).toBe("Silent");
  expect(audio({ ...report, timing: { ...report.timing!, media: [{ role: "extra", state: "playing", positionMs: 0, targetMs: null, driftMs: null }] }, mediaExpected: false }).label).toBe("Music only");
  expect(audioRemaining([audio(), { ...audio(), remainingMs: 13000 }])).toBe("~0:11–0:13");
});
it("uses leaf rosters, separates late arrivals, retains empty groups and shares cues before a split", () => {
  const nested = { ...status, participants: [...status.participants, person("late")], groups: [...status.groups!, { id: "parent", label: "Parent" }, { id: "empty", label: "Empty" }],
    groupPaths: [...status.groupPaths, { ...status.groupPaths[0]!, groupId: "parent", state: "split" as const, memberIds: ["A01", "B01"] }] };
  const groups = monitorGroups(nested);
  expect(groups.map(g => [g.id, g.participants.map(p => p.clientId)])).toEqual([["a", ["A01"]], ["b", ["B01"]], ["empty", []], ["__shared", ["late"]]]);
  expect(groups.at(-1)?.state).toBe("unassigned");
  const shared = monitorGroups({ ...status, groupPathsStarted: false, phaseId: "shared", phaseTiming: { startedAt: 20, deadlineAt: 50 } });
  expect(shared.every(g => g.phaseId === "shared" && g.deadlineAt === 50)).toBe(true);
});
it("shows all groups, expands all devices, switches views, and stops the clocks when updates go stale", async () => {
  const clock = new ServerClock(); clock.addSample(10000, 10000, 10000);
  await act(async () => root.render(<ShowMonitor status={status} clock={clock} sceneTitle={id => id} stale={false} receivedAt={10000} />));
  expect(host.textContent).toContain("~0:11"); expect(host.textContent).toContain("0:30"); expect(host.textContent).toContain("Reunion · 1 / 2 groups ready");
  expect(host.querySelectorAll('.show-monitor-track')).toHaveLength(1);
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Show all devices')!.click());
  expect(host.querySelectorAll('tr[id][hidden]')).toHaveLength(0);
  expect(host.textContent).toContain('voice.mp3');
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Table')!.click());
  expect(host.querySelectorAll('.show-monitor-track')).toHaveLength(0);
  await act(async () => vi.advanceTimersByTimeAsync(6250));
  expect(host.textContent).toContain('Updates stale'); expect(host.textContent).not.toContain('~0:');
});
