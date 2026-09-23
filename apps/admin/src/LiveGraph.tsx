import { useMemo, useState } from "react";
import type { Status, FlowScene, SceneFlow } from "./App.js";

type Props = {
  flow: SceneFlow; status: Status; busy: boolean;
  onJump: (scene: FlowScene, trigger: HTMLButtonElement, groupId?: string) => void;
  onAssign: (participantId: string, groupId: string) => Promise<void>;
};

/** Deterministic graph layout from the published routes, including cycles and disconnected scenes. */
export function graphPositions(flow: SceneFlow): Map<string, { x: number; y: number }> {
  const routes = new Map(flow.scenes.map((scene) => [scene.id, scene.routes.map((route) => route.target)]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const forward = new Map<string, string[]>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id); visiting.add(id);
    const targets: string[] = [];
    for (const target of routes.get(id) ?? []) {
      if (visiting.has(target)) continue; // Draw loop edges, but don't use them to rank nodes.
      targets.push(target); visit(target);
    }
    forward.set(id, targets); visiting.delete(id); order.push(id);
  };
  visit(flow.entryPhaseId);
  for (const scene of flow.scenes) visit(scene.id);
  const rank = new Map([...visited].map((id) => [id, 0]));
  for (const id of order.reverse()) for (const target of forward.get(id) ?? []) rank.set(target, Math.max(rank.get(target)!, rank.get(id)! + 1));
  const rows = new Map<number, number>();
  return new Map([...rank].map(([id, column]) => {
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return [id, { x: 28 + column * 290, y: 35 + row * 190 }];
  }));
}

export function LiveGraph({ flow, status, busy, onJump, onAssign }: Props) {
  const [selected, setSelected] = useState(status.groupPaths.find((path) => !path.done && path.state !== "empty" && path.acceptingParticipants !== false)?.phaseId ?? status.phaseId ?? flow.entryPhaseId);
  const [scope, setScope] = useState("");
  const [zoom, setZoom] = useState(1);
  const [participantId, setParticipantId] = useState("");
  const positions = useMemo(() => graphPositions(flow), [flow]);
  const width = Math.max(600, ...[...positions.values()].map((p) => p.x + 265));
  const height = Math.max(280, ...[...positions.values()].map((p) => p.y + 160));
  const paths = status.groupPaths;
  const located = new Set(paths.flatMap((path) => path.memberIds));
  const waiting = status.groupPathsStarted ? status.participants.filter((p) => !located.has(p.clientId)) : [];
  const nodeFor = (path: Status["groupPaths"][number]) => path.done ? path.reunionPhaseId ?? path.phaseId : path.phaseId;
  const selectedPaths = paths.filter((path) => nodeFor(path) === selected);
  const members = status.participants.filter((p) => status.groupPathsStarted
    ? selectedPaths.some((path) => path.memberIds.includes(p.clientId))
    : selected === status.phaseId);
  const scene = flow.scenes.find((item) => item.id === selected);
  const selectedScope = paths.find((path) => path.groupId === scope && path.state !== "split");
  const canJump = status.lifecycle === "active" && !busy && scene && (status.groupPathsStarted
    ? selectedScope && !selectedScope.done && selectedScope.phaseId !== scene.id && selectedScope.jumpTargets?.includes(scene.id)
    : status.phaseId !== scene.id);
  const destinations = status.groupDestinations && status.groups
    ? status.groups.filter((group) => status.groupDestinations!.includes(group.id)).map((group) => ({ id: group.id, label: group.label }))
    : paths.filter((path) => path.acceptingParticipants !== false).map((path) => ({ id: path.groupId, label: path.label }));
  const roster = (people: Status["participants"]) => <ul className="live-roster">{people.map((p) => <li key={p.clientId}>
    <strong title={p.clientId}>{p.name}</strong>{p.state && <small>{({ choosing: "Choosing a group", unassigned: "Needs assignment", active: "Active", finished: "Finished" })[p.state]}</small>}<span>{p.connected ? "Connected" : "Disconnected"}</span>
    <small>{(() => { const path = paths.find((item) => item.memberIds.includes(p.clientId)); return path ? `${status.groups?.find((g) => g.id === p.groupId)?.label ?? path.label} · ${path.done ? "Waiting at reunion" : path.phaseTitle}` : status.groupPathsStarted ? "Needs assignment" : `${status.groups?.find((g) => g.id === p.groupId)?.label ?? "Unassigned"} · Shared timeline`; })()}</small>
    <label>Move {p.name} to group<select className="sc-tool-select" aria-label={`Move ${p.name} to group`} value="" disabled={busy} onChange={(event) => void onAssign(p.clientId, event.target.value)}>
      <option value="">Choose destination…</option>
      {destinations.map((group) => <option key={group.id} value={group.id} disabled={p.groupId === group.id}>{group.label}</option>)}
    </select></label>
  </li>)}</ul>;
  return <div className="live-show">
    <div className="live-graph-toolbar"><label>Graph zoom <select className="sc-tool-select" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}><option value={0.65}>65%</option><option value={0.8}>80%</option><option value={1}>100%</option><option value={1.25}>125%</option></select></label><span>Scroll to explore · select a scene to inspect</span></div>
    <div className="live-graph-scroll" tabIndex={0} aria-label="Live show graph">
      <div style={{ width: width * zoom, height: height * zoom }}><div className="live-graph-canvas" style={{ width, height, transform: `scale(${zoom})` }}>
        <svg className="live-graph-edges" width={width} height={height} aria-hidden="true"><defs><marker id="live-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor" /></marker></defs>
          {flow.scenes.flatMap((source) => source.routes.map((route, index) => {
            const from = positions.get(source.id); const to = positions.get(route.target);
            if (!from || !to) return null;
            const x = from.x + 240; const y = from.y + 60 + index * 16; const ty = to.y + 55;
            const d = to.x - from.x > 290 ? `M${x},${y} C${x + 25},${y} ${x + 25},${height - 12} ${x + 35},${height - 12} L${to.x - 25},${height - 12} C${to.x - 15},${height - 12} ${to.x - 20},${ty} ${to.x},${ty}` : `M${x},${y} C${x + 35},${y} ${to.x - 35},${ty} ${to.x},${ty}`;
            return <g key={`${source.id}:${route.outcome}`}><path d={d} markerEnd="url(#live-arrow)" /><text x={x + 6} y={y - 5}>{route.outcome}</text></g>;
          }))}
        </svg>
        {[...flow.scenes, ...(positions.has("idle") ? [{ id: "idle", title: "End", kind: "idle", routes: [] }] : [])].map((node) => {
          const pos = positions.get(node.id)!;
          const here = paths.filter((path) => path.state !== "empty" && nodeFor(path) === node.id);
          const shared = !status.groupPathsStarted && node.id === status.phaseId;
          return <button key={node.id} type="button" className="live-graph-node sc-tool-graph-node" style={{ left: pos.x, top: pos.y }} data-selected={selected === node.id} data-live={shared || here.length > 0} data-sc-tool-domain={node.kind === "group-branch" ? "branch" : node.kind === "video" ? "video" : node.kind === "idle" ? "idle" : "question"} onClick={() => setSelected(node.id)} aria-label={`Inspect ${node.title}`} aria-pressed={selected === node.id}>
            <span>{node.kind === "group-branch" ? "Group branch" : node.kind === "video" ? "Media" : node.kind === "idle" ? "End" : "Question"}{node.id === flow.entryPhaseId ? " · Entry" : ""}</span><strong>{node.title}</strong><small>{node.id}</small>
            {shared && <b>Now · {status.participants.length} participants</b>}
            {here.map((path) => <b key={`${path.groupId}:${path.phaseEpoch}`} style={{ borderLeft: `3px solid ${path.color ?? "currentColor"}`, paddingLeft: 5 }}>{path.label} · {path.memberIds.length}{path.done ? " · waiting" : " · live"}</b>)}
          </button>;
        })}
      </div></div>
    </div>
    <div className="live-inspector">
      <div><h3>{scene?.title ?? "End"}</h3><p>{members.length} participants here{selectedPaths.some((path) => path.done) ? " · waiting for the other groups" : ""}</p>
        {status.groupPathsStarted && <label className="sc-tool-label">Group to move<select className="sc-tool-select" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Choose a group…</option>{paths.filter((p) => !p.done && p.state !== "empty" && p.acceptingParticipants !== false).map((p) => <option key={p.groupId} value={p.groupId}>{p.label} · {p.memberIds.length} participants</option>)}</select></label>}
        <button className="sc-tool-button" type="button" disabled={!canJump} onClick={(e) => scene && onJump(scene, e.currentTarget, status.groupPathsStarted ? scope : undefined)}>{status.groupPathsStarted ? `Move ${selectedScope?.label ?? "group"} to this scene` : "Jump whole show to this scene"}</button>
        {status.groupPathsStarted && <p className="sc-tool-help">Group jumps start the chosen scene from its beginning. Participant transfers join the group’s current playback position.</p>}
        {scene && <p className="sc-tool-help">{scene.routes.map((route) => `${route.outcome} → ${route.target}`).join(" · ")}</p>}
      </div>
      <div><label className="sc-tool-label">Participant<select className="sc-tool-field" value={participantId} onChange={(e) => setParticipantId(e.target.value)}><option value="">Participants in this scene</option>{status.participants.map((p) => <option key={p.clientId} value={p.clientId}>{p.name} · {p.clientId}</option>)}</select></label>{roster(participantId ? status.participants.filter((p) => p.clientId === participantId) : members)}
        {status.groupPathsStarted && !participantId && <div><h3>Waiting / needs assignment · {waiting.length}</h3>{roster(waiting)}</div>}
      </div>
    </div>
  </div>;
}
