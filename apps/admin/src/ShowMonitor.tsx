import { Fragment, useEffect, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import type { Status } from "./App.js";
import { audioRemaining, audioSummary, clockText, deviceAudio, monitorGroups, REPORT_MAX_AGE_MS, type MonitorGroup } from "./show-monitor-model.js";

type Props = { status: Status; clock: ServerClock; sceneTitle: (id: string) => string; stale: boolean; receivedAt: number | null };

function Timeline({ group, now }: { group: MonitorGroup; now: number | null }) {
  if (now === null || group.startedAt === undefined || group.state === "empty" || group.state === "unassigned" || group.state === "finished") return null;
  // Every row shares one rolling scale: one minute behind, ninety seconds ahead.
  const x = (time: number) => Math.max(0, Math.min(100, (time - now + 60000) / 1500));
  const start = x(group.startedAt), end = x(group.deadlineAt ?? now);
  return <div className="show-monitor-track" role="img" aria-label={group.deadlineAt == null ? "Open-ended scene" : `Scene ends in ${clockText(group.deadlineAt - now)}`}>
    <span className="show-monitor-span" style={{ left: `${start}%`, width: `${Math.max(0, end - start)}%` }} />
    <span className="show-monitor-now" />
  </div>;
}

export function ShowMonitor({ status, clock, sceneTitle, stale, receivedAt }: Props) {
  const [localNow, setLocalNow] = useState(Date.now);
  const [timeline, setTimeline] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => { const timer = setInterval(() => setLocalNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const elapsed = receivedAt === null ? 0 : Math.max(0, localNow - receivedAt);
  const outdated = stale || receivedAt === null || elapsed > REPORT_MAX_AGE_MS;
  const now = !outdated && clock.ready ? clock.now(localNow) : null;
  const reports = new Map((status.timingMonitors ?? []).map(row => [row.id, row]));
  const rows = monitorGroups(status).map(group => ({ group, devices: group.participants.map(p => ({ participant: p,
    audio: deviceAudio(p, group, reports.get(`phone:${p.clientId}`), elapsed, outdated, now) })) }));
  const attention = rows.flatMap(({ group, devices }) => devices.filter(d => d.audio.attention).map(d => ({ ...d, groupId: group.id })));
  const occupied = rows.filter(r => r.group.participants.length && r.group.state !== "unassigned");
  const allExpanded = rows.filter(r => r.group.participants.length).every(r => expanded.has(r.group.id));
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const scene = (g: MonitorGroup) => g.state === "finished" ? "At reunion" : g.state === "unassigned" ? "Waiting for assignment" : g.phaseId ? sceneTitle(g.phaseId) : "—";
  const sceneRemaining = (g: MonitorGroup) => outdated ? "—" : g.state === "empty" ? "—" : g.state === "finished" || g.state === "unassigned" ? "Waiting" : now === null ? "—"
    : g.deadlineAt == null ? "Open" : now >= g.deadlineAt ? "Transitioning" : clockText(g.deadlineAt - now);
  return <section className="sc-tool-panel show-monitor" aria-labelledby="show-monitor-heading">
    <div className="admin-section-heading"><h2 id="show-monitor-heading">Show monitor</h2><span className="sc-tool-help">{outdated ? "Updates stale" : `${status.connectedParticipants} / ${status.participants.length} online`}</span></div>
    <div className="show-monitor-toolbar">
      <div role="group" aria-label="Monitor view"><button type="button" className="sc-tool-button" aria-pressed={timeline} onClick={() => setTimeline(true)}>Timeline</button><button type="button" className="sc-tool-button" aria-pressed={!timeline} onClick={() => setTimeline(false)}>Table</button></div>
      <button type="button" className="sc-tool-button" disabled={!status.participants.length} aria-expanded={allExpanded} onClick={() => setExpanded(allExpanded ? new Set() : new Set(rows.map(r => r.group.id)))}>{allExpanded && status.participants.length ? "Hide devices" : "Show all devices"}</button>
    </div>
    {outdated ? <p className="sc-tool-help" role="status">Waiting for live updates.</p> : attention.length > 0 && <details className="show-monitor-attention"><summary>{attention.length} {attention.length === 1 ? "device needs" : "devices need"} attention</summary><ul>{attention.map(({ participant, audio, groupId }) => <li key={participant.clientId}><button type="button" className="sc-tool-button" onClick={() => setExpanded(previous => new Set([...previous, groupId]))}>{participant.deviceLabel ?? participant.name} · {audio.label}</button></li>)}</ul></details>}
    <div className="clock-table-scroll" role="region" aria-label="Groups and devices" tabIndex={0}>
      <table className="show-monitor-table"><thead><tr><th scope="col">Group</th><th scope="col">Scene{timeline && <div className="show-monitor-axis" aria-hidden="true"><span>−1:00</span><span>Now</span><span>+1:30</span></div>}</th><th scope="col">Audio</th><th scope="col">Audio left</th><th scope="col">Scene left</th></tr></thead><tbody>
        {rows.map(({ group, devices }, index) => {
          const audios = devices.map(d => d.audio);
          const unknown = audios.filter(a => a.remainingMs === null && a.label !== "Silent" && a.label !== "Music only").length;
          const detailId = `show-monitor-devices-${index}`;
          return <Fragment key={group.id}><tr>
            <th scope="row"><button type="button" className="show-monitor-group" disabled={!devices.length} aria-expanded={expanded.has(group.id)} aria-controls={detailId} onClick={() => toggle(group.id)}><span aria-hidden="true">{expanded.has(group.id) ? "▾" : "▸"}</span> {group.label}</button><small>{group.participants.filter(p => p.connected).length} / {devices.length} online</small></th>
            <td><strong>{scene(group)}</strong>{timeline && <Timeline group={group} now={now} />}</td>
            <td>{audioSummary(audios)}</td>
            <td className="show-monitor-time">{audioRemaining(audios)}{unknown > 0 && audios.some(a => a.remainingMs !== null && a.label !== "Ended") && <small>{unknown} unknown</small>}</td>
            <td className="show-monitor-time">{sceneRemaining(group)}</td>
          </tr><tr id={detailId} hidden={!expanded.has(group.id) || !devices.length}><td colSpan={5} className="show-monitor-details"><table><caption className="show-monitor-caption">{group.label} devices</caption><thead><tr><th scope="col">Device</th><th scope="col">Scene</th><th scope="col">Audio</th><th scope="col">Reported position</th><th scope="col">Audio left</th><th scope="col">Report age</th></tr></thead><tbody>
            {devices.map(({ participant: p, audio: a }) => <tr key={p.clientId}><th scope="row">{p.deviceLabel ?? p.name}{p.deviceLabel && p.deviceLabel !== p.name && <small>{p.name}</small>}</th><td>{p.state === "unassigned" ? "Unassigned" : p.state === "finished" ? "At reunion" : p.phaseId ? sceneTitle(p.phaseId) : "—"}</td><td>{a.label}{a.music && <small>{a.music}</small>}{a.src && <small className="show-monitor-source">{a.src}</small>}{a.driftMs !== null && Math.abs(a.driftMs) > 250 && <small>{Math.round(a.driftMs)} ms drift</small>}</td><td>{a.positionMs === null ? "—" : clockText(a.positionMs)}{a.durationMs !== null && ` / ${clockText(a.durationMs)}`}</td><td className="show-monitor-time">{a.label === "Ended" ? "Done" : a.remainingMs !== null ? `~${clockText(a.remainingMs)}` : (a.label === "Silent" || a.label === "Music only") ? "—" : "Unknown"}</td><td>{a.reportAgeMs === null ? "—" : `${Math.floor(a.reportAgeMs / 1000)}s`}</td></tr>)}
          </tbody></table></td></tr></Fragment>;
        })}
      </tbody></table>
    </div>
    {status.groupPathsStarted && <p className="show-monitor-reunion">Reunion · {occupied.filter(r => r.group.state === "finished").length} / {occupied.length} groups ready</p>}
    <details className="show-monitor-help"><summary>Timing details</summary><p>~ estimates audio remaining from fresh device reports. Reports older than 6s are stale. Playback reports do not confirm headphone sound. Older app builds may not report audio length.</p></details>
  </section>;
}
