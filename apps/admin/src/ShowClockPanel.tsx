import { useEffect, useState } from "react";
import { StatusIcon, type ToolStatus } from "@entertheblackbox/tool-ui";
import type { ServerClock } from "@entertheblackbox/shared";
import type { TimingMonitor } from "@entertheblackbox/protocol";
import type { Status } from "./App.js";

export function timingHealth(row: TimingMonitor, elapsed: number, stale: boolean): { label: string; status: ToolStatus } {
  if (stale) return { label: "Updates stale", status: "warning" };
  if (!row.connected) return { label: "Disconnected", status: "danger" };
  const timing = row.timing;
  if (!timing || row.reportAgeMs === null) return { label: "Awaiting report", status: "warning" };
  if (row.reportAgeMs + elapsed > 6000) return { label: "Report stale", status: "warning" };
  if (!timing.calibrated) return { label: "Clock estimating", status: "warning" };
  if (timing.sampleAgeMs === null || timing.sampleAgeMs + row.reportAgeMs + elapsed > 30000) return { label: "Clock stale", status: "warning" };
  if (timing.mode === "stream") return { label: "Stream drift unmeasured", status: "info" };
  if (!row.mediaExpected && !timing.media.length) return { label: "Clock measured", status: "info" };
  if (timing.elapsedMs < 0) return { label: "Waiting for cue", status: "info" };
  if (!timing.media.length) return { label: "Awaiting media", status: "warning" };
  const issue = timing.media.find((m) => ["error", "disabled", "loading", "seeking", "paused", "waiting"].includes(m.state));
  if (issue) return { label: `Audio/video ${issue.state}`, status: issue.state === "error" ? "danger" : "warning" };
  if (timing.media.every((m) => m.state === "ended")) return { label: "Cue tail", status: "info" };
  if (timing.media.some((m) => m.driftMs === null)) return { label: "Drift unmeasured", status: "info" };
  if (timing.media.some((m) => Math.abs(m.driftMs!) > 250)) return { label: "Out of sync", status: "danger" };
  return { label: "Within tolerance", status: "success" };
}

export function ShowClockPanel({ clock, status, stale, receivedAt }: { clock: ServerClock; status: Status; stale: boolean; receivedAt: number | null }) {
  const [localNow, setLocalNow] = useState(Date.now);
  const [filter, setFilter] = useState<"all" | "display" | "phone">("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  useEffect(() => { const timer = setInterval(() => setLocalNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const elapsed = receivedAt === null ? 0 : Math.max(0, localNow - receivedAt);
  const outdated = stale || receivedAt === null || elapsed > 6000;
  const monitors = status.timingMonitors ?? [];
  const attention = (row: TimingMonitor) => ["warning", "danger"].includes(timingHealth(row, elapsed, outdated).status);
  const count = monitors.filter(attention).length;
  const visible = monitors.filter((row) => (filter === "all" || row.kind === filter) && (!attentionOnly || attention(row)));
  const overview = outdated ? "Updates stale" : !monitors.length ? "Awaiting reports" : count ? `${count} ${count === 1 ? "device needs" : "devices need"} attention` : "Reports current";
  const now = clock.now(localNow);
  const rows = [
    ...(status.phaseTiming ? [{ key: "shared", label: "Shared", phaseId: status.phaseId, startedAt: status.phaseTiming.startedAt, state: status.lifecycle }] : []),
    ...status.groupPaths.map((path) => ({ key: `${path.groupId}:${path.phaseEpoch}`, label: path.label, phaseId: path.phaseId, startedAt: path.startedAt, state: path.state })),
  ];
  return <section className="sc-tool-panel show-clock-monitor" aria-labelledby="show-clock-heading">
    <div className="admin-section-heading">
      <div><p className="sc-tool-eyebrow">Displays and phones / every 2 seconds</p><h2 id="show-clock-heading">Show clock monitor</h2></div>
      <span className="sc-tool-status" data-sc-tool-status={outdated || !monitors.length || count ? "warning" : "success"}><StatusIcon status={outdated || !monitors.length || count ? "warning" : "success"} />{overview}</span>
    </div>
    <dl className="clock-summary">
      <div><dt>Central server time · UTC</dt><dd>{clock.ready ? new Date(now).toISOString().slice(11, 23) : "—"}</dd></div>
      <div><dt>Admin offset / round trip</dt><dd>{clock.ready ? `${Math.round(clock.offset)} / ${clock.roundTripMs ?? "—"} ms` : "—"}</dd></div>
      <div><dt>Dashboard update age</dt><dd>{receivedAt === null ? "—" : `${(elapsed / 1000).toFixed(1)} s`}</dd></div>
    </dl>
    <div className="clock-filters"><label>Devices <select className="sc-tool-field" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">All devices</option><option value="display">Displays</option><option value="phone">Phones</option></select></label>
      <label><input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} /> Needs attention only</label></div>
    <div className="clock-table-scroll" tabIndex={0} role="region" aria-label="Device synchronization table">
      <table><thead><tr><th scope="col">Device / cue</th><th scope="col">Sync status</th><th scope="col">Position / target</th><th scope="col">Drift</th><th scope="col">Clock offset / RTT</th><th scope="col">Report age</th></tr></thead><tbody>
        {visible.map((row) => { const result = timingHealth(row, elapsed, outdated); return <tr key={row.id}>
          <th scope="row">{row.label}<small>{row.kind} · {row.phaseId} · epoch {row.phaseEpoch}</small></th>
          <td><span className="sc-tool-status" data-sc-tool-status={result.status}><StatusIcon status={result.status} />{result.label}</span></td>
          <td>{row.timing?.media.length ? row.timing.media.map((m) => <div key={m.role}>{m.role}: {m.positionMs === null ? "—" : (m.positionMs / 1000).toFixed(2)} / {m.targetMs === null ? "—" : (m.targetMs / 1000).toFixed(2)} s<small>{m.state}</small></div>) : row.timing?.mode === "stream" ? "Stream position unavailable" : row.mediaExpected ? "No media report" : "No timed media"}</td>
          <td>{row.timing?.media.length ? row.timing.media.map((m) => <div key={m.role}>{m.role}: {m.driftMs === null ? "—" : `${Math.round(m.driftMs)} ms`}</div>) : "—"}</td>
          <td>{row.timing ? `${Math.round(row.timing.offsetMs)} / ${row.timing.roundTripMs ?? "—"} ms` : "—"}</td>
          <td>{row.reportAgeMs === null ? "—" : `${((row.reportAgeMs + elapsed) / 1000).toFixed(1)} s`}</td>
        </tr>; })}
      </tbody></table>
      {!visible.length && <p>{monitors.length ? "No devices match this filter." : "No timing reports are available yet."}</p>}
    </div>
    <p className="sc-tool-help">Positions are last reported browser estimates. Within tolerance means ±250 ms at that report; reports older than 6 seconds are stale. Synchronized phone audio includes estimated output latency. Stream buffering and actual headphone output are not measured.</p>
    <details><summary>Cue timesheet · {rows.length} {rows.length === 1 ? "timeline" : "timelines"}</summary><div className="clock-table-scroll"><table><thead><tr><th>Timeline</th><th>Scene</th><th>State</th><th>Cue elapsed</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.phaseId}</td><td>{row.state}</td><td>{row.startedAt === undefined || !clock.ready ? "—" : `${(Math.max(0, now - row.startedAt) / 1000).toFixed(1)} s`}</td></tr>)}
    </tbody></table></div></details>
    <p><a href="/admin/?view=audio">Per-phone stream and recovery diagnostics</a></p>
  </section>;
}
