import { useEffect, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import type { Status } from "./App.js";

function timecode(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function ShowClockPanel({ clock, status, stale }: { clock: ServerClock; status: Status; stale: boolean }) {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(clock.now()), 250);
    return () => clearInterval(timer);
  }, [clock]);
  const rows = [
    ...(status.phaseTiming ? [{ key: "shared", label: "Shared", phaseId: status.phaseId, startedAt: status.phaseTiming.startedAt, state: status.lifecycle }] : []),
    ...status.groupPaths.map((path) => ({ key: `${path.groupId}:${path.phaseEpoch}`, label: path.label, phaseId: path.phaseId, startedAt: path.startedAt, state: path.state })),
  ];
  return <details className="sc-tool-panel">
    <summary>Show clock · {clock.ready ? new Date(now).toISOString().slice(11, 23) + " UTC" : "Waiting for server"}</summary>
    <p>{stale || (clock.sampleAgeMs() ?? Infinity) > 6000 ? "Timing status is stale" : "Server timing received"} · offset {Math.round(clock.offset)} ms · round trip {clock.roundTripMs ?? "—"} ms</p>
    <table><thead><tr><th>Timeline</th><th>Scene</th><th>State</th><th>Cue elapsed</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.phaseId}</td><td>{row.state}</td><td>{row.startedAt === undefined || !clock.ready ? "—" : timecode(now - row.startedAt)}</td></tr>)}</tbody>
    </table>
    <p>Each group shares server time and has its own cue start. These are target positions; use the display’s timing overlay to inspect actual playback.</p>
  </details>;
}
