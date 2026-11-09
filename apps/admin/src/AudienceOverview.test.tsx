// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerClock } from "@entertheblackbox/shared";
import { AudienceOverview, audienceSummary } from "./AudienceOverview.js";
import type { Status } from "./App.js";

const participant = (clientId: string, name: string, groupId: string | null, client: "native" | "web", phaseId: string, phaseStartedAt: number, connected = true) =>
  ({ clientId, name, color: "#fff", connected, joinedAt: 0, lastSeenAt: 0, groupId, client, phaseId, phaseStartedAt, state: "active" as const });
const status = {
  groups: [{ id: "ki", label: "KI · Bühne", color: "#f55" }, { id: "theater", label: "Theater · Saal", color: "#55f" }, { id: "empty", label: "Empty" }],
  participants: [
    { ...participant("t2", "T02", "ki", "native", "vorhang", 8000), deviceLabel: "T02" },
    participant("t1", "T01", "ki", "native", "vorhang", 8000, false),
    participant("w1", "Ada", "theater", "web", "vorhang", 8000),
    { ...participant("t3", "Bo", "ki", "native", "vorhang", 8000), deviceLabel: "T03" },
    participant("w2", "Late", null, "web", "vorhang", 8000),
  ],
  timingMonitors: [{ id: "phone:t2", label: "T02", kind: "phone", phaseId: "vorhang", phaseEpoch: 1, connected: true, mediaExpected: true, reportAgeMs: 0,
    timing: { calibrated: true, offsetMs: 0, roundTripMs: 1, sampleAgeMs: 0, elapsedMs: 0, mode: "synchronized", media: [{ role: "main", positionMs: 61_000, targetMs: 61_000, driftMs: 0, state: "playing" }] } }],
} as unknown as Status;

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("counts each group with online devices and flags people without a group", () => {
  expect(audienceSummary(status).map(({ id, total, online }) => [id, total, online])).toEqual([["ki", 3, 2], ["theater", 1, 1], [null, 1, 1]]);
});

it("shows every device's group, client and current cue, and filters by group", async () => {
  const clock = new ServerClock(); clock.addSample(10000, 10000, 10000);
  await act(async () => root.render(<AudienceOverview status={status} clock={clock} sceneTitle={(id) => id === "vorhang" ? "Vorhang · GO" : id} stale={false} />));
  expect(host.textContent).toContain("App 3 · Web 2");
  const rows = () => [...host.querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => cell.textContent));
  expect(rows()).toEqual([
    ["BoApp · T03", "KI · Bühne", "Vorhang · GO", "0:02", "—"],
    ["T01App · offline", "KI · Bühne", "Vorhang · GO", "0:02", "—"],
    ["T02App", "KI · Bühne", "Vorhang · GO", "0:02", "playing 1:01"],
    ["AdaWeb", "Theater · Saal", "Vorhang · GO", "0:02", "—"],
    ["LateWeb", "No group", "Vorhang · GO", "0:02", "—"],
  ]);
  const chip = [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("No group"))!;
  await act(async () => chip.click());
  expect(rows().map((row) => row[0])).toEqual(["LateWeb"]);
  expect(host.textContent).not.toContain("Empty");
});
