import { useEffect, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import type { Status } from "./App.js";

type Participant = Status["participants"][number];
export type AudienceGroupCount = { id: string | null; label: string; color?: string | undefined; total: number; online: number };

/** Per-group head counts; participants without a group are counted last as a warning row. */
export function audienceSummary(status: Pick<Status, "participants" | "groups">): AudienceGroupCount[] {
  const count = (rows: Participant[]) => ({ total: rows.length, online: rows.filter((row) => row.connected).length });
  const rows: AudienceGroupCount[] = (status.groups ?? []).map((group) => ({ id: group.id, label: group.label, color: group.color,
    ...count(status.participants.filter((p) => p.groupId === group.id)) })).filter((row) => row.total > 0);
  const ungrouped = status.participants.filter((p) => !p.groupId || !status.groups?.some((group) => group.id === p.groupId));
  if (ungrouped.length && status.groups?.length) rows.push({ id: null, label: "No group", ...count(ungrouped) });
  return rows;
}

const clockText = (ms: number) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Who is in which group and on which cue right now; the device's own playback report where it has one. */
export function AudienceOverview({ status, clock, sceneTitle, stale }: { status: Status; clock: ServerClock; sceneTitle: (id: string) => string; stale: boolean }) {
  const [now, setNow] = useState(Date.now);
  const [filter, setFilter] = useState<string | null | undefined>(undefined);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const summary = audienceSummary(status);
  const clients = { native: status.participants.filter((p) => p.client === "native").length, web: status.participants.filter((p) => p.client === "web").length };
  const groupOf = (p: Participant) => status.groups?.find((group) => group.id === p.groupId) ?? null;
  const order = (p: Participant) => { const index = status.groups?.findIndex((group) => group.id === p.groupId) ?? -1; return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const visible = status.participants
    .filter((p) => filter === undefined || (filter === null ? !groupOf(p) : p.groupId === filter))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  const serverNow = clock.ready ? clock.now(now) : null;
  const audio = (id: string) => {
    const main = status.timingMonitors?.find((row) => row.id === `phone:${id}`)?.timing?.media.find((m) => m.role === "main");
    if (!main) return "—";
    return main.positionMs === null ? main.state : `${main.state} ${clockText(main.positionMs)}`;
  };
  if (!status.participants.length) return <section className="sc-tool-panel admin-audience" aria-labelledby="admin-audience-heading">
    <h2 id="admin-audience-heading">Audience</h2><p className="sc-tool-help">Nobody has joined yet.</p></section>;
  return <section className="sc-tool-panel admin-audience" aria-labelledby="admin-audience-heading">
    <div className="admin-section-heading"><div><p className="sc-tool-eyebrow">App {clients.native} · Web {clients.web}</p><h2 id="admin-audience-heading">Audience</h2></div></div>
    <div className="admin-audience-summary" role="group" aria-label="Filter by group">
      <button type="button" className="admin-audience-chip" aria-pressed={filter === undefined} onClick={() => setFilter(undefined)}>All <strong>{status.participants.length}</strong></button>
      {summary.map((row) => <button key={row.id ?? "none"} type="button" className="admin-audience-chip" data-warning={row.id === null || undefined} aria-pressed={filter === row.id}
        onClick={() => setFilter(filter === row.id ? undefined : row.id)}>
        <span className="admin-audience-swatch" style={{ background: row.color ?? "currentColor" }} aria-hidden="true" />{row.label} <strong>{row.total}</strong> <small>{row.online} online</small>
      </button>)}
    </div>
    <div className="clock-table-scroll" tabIndex={0} role="region" aria-label="Audience cues">
      <table className="admin-audience-table"><thead><tr><th scope="col">Device</th><th scope="col">Group</th><th scope="col">Cue now</th><th scope="col">In cue</th><th scope="col">Audio</th></tr></thead><tbody>
        {visible.map((p) => <tr key={p.clientId} data-offline={!p.connected || undefined}>
          <th scope="row">{p.name}<small>{p.client === "native" ? "App" : p.client === "web" ? "Web" : "—"}{p.connected ? "" : " · offline"}</small></th>
          <td>{groupOf(p)?.label ?? <span className="admin-audience-missing">No group</span>}</td>
          <td>{p.state === "unassigned" ? "Waiting for a group" : p.state === "finished" ? "Waiting at reunion" : p.phaseId ? sceneTitle(p.phaseId) : "—"}</td>
          <td>{stale || serverNow === null || p.phaseStartedAt === undefined ? "—" : clockText(serverNow - p.phaseStartedAt)}</td>
          <td>{audio(p.clientId)}</td>
        </tr>)}
      </tbody></table>
    </div>
  </section>;
}
