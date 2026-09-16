// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AudioDiagnostics } from "./AudioDiagnostics";
import type { Status } from "./App";
let root: Root;
let host: HTMLDivElement;
const status = { participants: [{ clientId: "one", connected: false }], audio: {
  configured: true, backend: "remote", poll_age_s: 1,
  players: [
    { player_id: "one", name: "Alex", connected: true, flagged: false, listeners: 1, playbackState: "playing", reconnects: 3, lastRecoveryMs: 1500, phoneReportAgeMs: 120000 },
    { player_id: "two", name: "Sam", connected: false, flagged: true, listeners: 0 },
  ],
} } as Status;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("distinguishes a stream connection from the show connection and absent telemetry", async () => {
  await act(async () => root.render(<AudioDiagnostics status={status} receivedAt={Date.now()} failed={false} />));
  const rows = host.querySelectorAll("tbody tr");
  expect(rows[0]!.textContent).toContain("Sam");
  expect(rows[0]!.textContent).toContain("No report");
  expect(rows[1]!.textContent).toContain("1 connected");
  expect(rows[1]!.textContent).toContain("Disconnected");
  expect(rows[1]!.textContent).toContain("Playing");
  expect(rows[1]!.textContent).toContain("1.5s");
  expect(rows[1]!.textContent).toContain("2m 0s ago");
  expect(host.textContent).toContain("1 of 2 phones reporting");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
});
it("ages the last snapshot while requests stop arriving", async () => {
  await act(async () => root.render(<AudioDiagnostics status={status} receivedAt={Date.now()} failed={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(16000));
  expect(host.textContent).toContain("Updates stale");
  expect(host.textContent).toContain("Last reported: 1 connected");
  expect(host.textContent).toContain("2m 16s ago");
});
it("shows backend failure and unknown telemetry instead of zero interruptions", async () => {
  const unavailable = { ...status, audio: { configured: true, error: "Bridge unavailable", players: [] } } as Status;
  await act(async () => root.render(<AudioDiagnostics status={unavailable} receivedAt={Date.now()} failed={false} />));
  expect(host.textContent).toContain("Audio backend: Bridge unavailable");
  expect(host.textContent).toContain("Phone roster unavailable");
  expect(host.querySelectorAll(".audio-summary dd")[3]!.textContent).toContain("—");
});
