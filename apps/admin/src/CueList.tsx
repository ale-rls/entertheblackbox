import { useMemo, useState, type ReactElement } from "react";
import type { FlowScene, SceneFlow, Status } from "./App.js";
import { allRows, buildCueList, optionsAt, primaryTarget, type CueRow } from "./cue-list-model.js";

type Props = {
  flow: SceneFlow; status: Status; busy: boolean;
  onJump: (scene: FlowScene, trigger: HTMLButtonElement, groupId?: string) => void;
  /** Light one of the current scene's operator fields (null = none) or step its counter. */
  onOperatorField?: (change: { target?: string | null; countDelta?: number }) => void;
};

const KIND_LABEL: Record<FlowScene["kind"], string> = {
  "video": "Media", "narration": "Narration", "position-question": "Vote", "video-position-question": "Vote", "group-branch": "Group split",
};

/** The operator's name for a scene: its script cue name, else its title. */
export const cueTitle = (scene: FlowScene) => scene.cueName ?? scene.title;

/** Operator view: what plays now, what comes next, where to act, and the whole show as a cue list. */
export function CueList({ flow, status, busy, onJump, onOperatorField }: Props) {
  const list = useMemo(() => buildCueList(flow), [flow]);
  const scenes = useMemo(() => new Map(flow.scenes.map((scene) => [scene.id, scene])), [flow]);
  const [scope, setScope] = useState("");
  const [showPast, setShowPast] = useState(false);
  const paths = status.groupPaths.filter((path) => path.state !== "empty" && path.state !== "split");
  const livePaths = paths.filter((path) => !path.done && path.acceptingParticipants !== false);
  const grouped = status.groupPathsStarted;
  const selectedScope = livePaths.find((path) => path.groupId === scope) ?? (livePaths.length === 1 ? livePaths[0] : undefined);

  // Where the show is: the shared scene, or each group's scene once paths run.
  const currentIds = grouped ? paths.map((path) => path.done ? path.reunionPhaseId ?? path.phaseId : path.phaseId) : status.phaseId ? [status.phaseId] : [];
  const focusId = grouped ? (selectedScope?.phaseId ?? currentIds[0] ?? null) : status.phaseId;
  // Past scenes: the main line, then whichever ending is playing.
  const mainOrder = [
    ...list.items.flatMap((item) => item.type === "scene" ? [item.row.scene.id] : []),
    ...(list.endings?.tracks.find((ending) => ending.rows.some((cue) => currentIds.includes(cue.scene.id)))?.rows.map((cue) => cue.scene.id) ?? []),
  ];
  const furthest = Math.max(-1, ...currentIds.map((id) => mainOrder.indexOf(id)));
  const isPast = (id: string) => { const index = mainOrder.indexOf(id); return index >= 0 && index < furthest; };

  // Fold finished scenes away so the current one stays near the top; keep the last two for context.
  const folded = new Set(showPast ? [] : mainOrder.slice(0, Math.max(0, furthest - 2)));

  const canJump = (scene: FlowScene) => status.lifecycle === "active" && !busy && (grouped
    ? Boolean(selectedScope && !selectedScope.done && selectedScope.phaseId !== scene.id && selectedScope.jumpTargets?.includes(scene.id))
    : status.phaseId !== scene.id);
  const jump = (scene: FlowScene, trigger: HTMLButtonElement) => onJump(scene, trigger, grouped ? selectedScope?.groupId : undefined);
  const goButton = (scene: FlowScene, label: string, primary = false) => <button type="button" className="sc-tool-button cue-go" data-sc-tool-variant={primary ? "primary" : "secondary"}
    disabled={!canJump(scene)} aria-label={`${label}: ${cueTitle(scene)}`} onClick={(event) => jump(scene, event.currentTarget)}>{label}</button>;

  const now = focusId ? scenes.get(focusId) : undefined;
  const nowRow = focusId ? allRows(list).find((row) => row.scene.id === focusId) : undefined;
  const nextId = now ? primaryTarget(now) : null;
  const options = focusId ? optionsAt(list, focusId) : [];
  const nextLabel = !now ? null
    : nowRow?.loops ? "Loops until you continue"
    : nextId === null || nextId === "idle" ? "End of show"
    : (scenes.get(nextId) ? cueTitle(scenes.get(nextId)!) : nextId);

  const row = (cue: CueRow, depth = 0): ReactElement => {
    const id = cue.scene.id;
    const here = paths.filter((path) => (path.done ? path.reunionPhaseId ?? path.phaseId : path.phaseId) === id);
    const live = (!grouped && status.phaseId === id) || here.length > 0;
    return <li key={id} className="cue-row" data-live={live} data-past={!live && isPast(id)} data-depth={depth}>
      <div className="cue-row-main">
        <span className="cue-mark" aria-hidden="true">{live ? "▶" : cue.loops ? "↻" : isPast(id) ? "✓" : ""}</span>
        <div className="cue-text">
          <strong>{cueTitle(cue.scene)}</strong>
          <small>{KIND_LABEL[cue.scene.kind]}{cue.scene.cueName && cue.scene.title !== id ? ` · ${cue.scene.title}` : ""}{cueTitle(cue.scene) !== id ? ` · ${id}` : ""}{cue.loops ? " · loops until you continue" : ""}</small>
          {live && !grouped && <b className="cue-live">Now · {status.participants.length} participants</b>}
          {here.map((path) => <b key={path.groupId} className="cue-live" style={{ borderInlineStart: `3px solid ${path.color ?? "currentColor"}` }}>{path.label} · {path.memberIds.length}{path.done ? " · waiting" : ""}</b>)}
        </div>
        {goButton(cue.scene, "Jump")}
      </div>
      {cue.variants.map((variant) => <div key={variant[0]!.scene.id} className="cue-aside"><span>or instead</span><ol>{variant.map((item) => row(item, depth + 1))}</ol></div>)}
      {cue.branches.map((branch) => <div key={branch.outcome} className="cue-aside"><span>route “{branch.outcome}”</span><ol>{branch.rows.map((item) => row(item, depth + 1))}</ol></div>)}
    </li>;
  };

  return <div className="cue-list">
    <section className="cue-now" aria-label="Now and next">
      {grouped ? <div className="cue-now-groups">
        <p className="sc-tool-eyebrow">Now · groups running</p>
        {paths.map((path) => <p key={path.groupId}><strong>{path.label}</strong> · {path.done ? "waiting at reunion" : path.phaseTitle} · {path.memberIds.length}</p>)}
        <label className="sc-tool-label">Jumps apply to<select className="sc-tool-select" value={selectedScope?.groupId ?? ""} onChange={(event) => setScope(event.target.value)}>
          <option value="">Choose a group…</option>
          {livePaths.map((path) => <option key={path.groupId} value={path.groupId}>{path.label} · {path.memberIds.length} participants</option>)}
        </select></label>
      </div> : <div>
        <p className="sc-tool-eyebrow">Now</p>
        <h3>{now ? cueTitle(now) : "Nothing playing"}</h3>
      </div>}
      <div>
        <p className="sc-tool-eyebrow">Next</p>
        <h3>{nextLabel ?? "—"}</h3>
      </div>
      {!grouped && now?.operatorFields && onOperatorField && status.lifecycle === "active" && <div className="cue-operator-fields" aria-label="Light a field">
        <p className="sc-tool-eyebrow">Light a field on the projection</p>
        <div className="cue-operator-buttons">
          {now.operatorFields.zones.map((zone) => <button key={zone.id} type="button" className="sc-tool-button" disabled={busy}
            aria-pressed={status.operatorField?.target === zone.id} style={zone.color ? { borderInlineStart: `6px solid ${zone.color}` } : undefined}
            onClick={() => onOperatorField({ target: zone.id })}>{zone.label}</button>)}
          <button type="button" className="sc-tool-button" data-sc-tool-variant="secondary" disabled={busy || !status.operatorField?.target} onClick={() => onOperatorField({ target: null })}>None</button>
        </div>
        {now.operatorFields.total !== undefined && <div className="cue-operator-buttons">
          <strong>{status.operatorField?.count ?? 0} / {now.operatorFields.total}</strong>
          <button type="button" className="sc-tool-button" data-sc-tool-variant="primary" disabled={busy} onClick={() => onOperatorField({ countDelta: 1 })}>+1</button>
          <button type="button" className="sc-tool-button" data-sc-tool-variant="secondary" disabled={busy || !status.operatorField?.count} onClick={() => onOperatorField({ countDelta: -1 })}>−1</button>
        </div>}
      </div>}
      {options.length > 0 && <div className="cue-options">
        <p className="sc-tool-eyebrow">Your options now</p>
        <ul>{options.map((option) => <li key={`${option.reason}:${option.scene.id}`}><span>{option.reason}</span><strong>{cueTitle(option.scene)}</strong>{goButton(option.scene, "Go", true)}</li>)}</ul>
      </div>}
    </section>

    {(folded.size > 0 || showPast) && furthest > 2 && <button type="button" className="sc-tool-button cue-fold" data-sc-tool-variant="secondary" onClick={() => setShowPast(!showPast)}>
      {showPast ? "Hide earlier scenes" : `Show ${folded.size} earlier scenes`}</button>}
    <ol className="cue-track" aria-label="Cue list">
      {list.items.filter((item, index) => {
        // A manual cue folds with the scene that loops or stops before it.
        const anchor = item.type === "scene" ? item : list.items[index - 1];
        return !(anchor?.type === "scene" && folded.has(anchor.row.scene.id));
      }).map((item) => item.type === "scene" ? row(item.row) : <li key={`manual:${item.target.id}`} className="cue-manual">
        <span>{item.after === "loop" ? "The scene above loops. When you're ready, continue with:" : "The show stops here. Continue with:"}</span>
        <strong>{cueTitle(item.target)}</strong>
        {goButton(item.target, "Go", true)}
      </li>)}
    </ol>

    {list.endings && <section className="cue-endings" aria-label="Endings">
      <h3>Ending{list.endings.afterSceneId ? ` · after “${scenes.get(list.endings.afterSceneId) ? cueTitle(scenes.get(list.endings.afterSceneId)!) : list.endings.afterSceneId}”` : ""}, choose one</h3>
      <div className="cue-ending-tracks">{list.endings.tracks.map((ending) => <div key={ending.label} className="cue-ending">
        <header><strong>{ending.label}{ending.rows[0] ? ` · ${cueTitle(ending.rows[0].scene)}` : ""}</strong><span>{ending.automatic ? "plays automatically" : "by hand"}</span>{ending.rows[0] && goButton(ending.rows[0].scene, `Go ${ending.label}`, !ending.automatic)}</header>
        <ol className="cue-track">{ending.rows.map((cue) => row(cue))}</ol>
      </div>)}</div>
    </section>}

    {list.others.length > 0 && <section className="cue-others" aria-label="Other scenes">
      <h3>Other scenes</h3>
      <ol className="cue-track">{list.others.flatMap((rows) => rows.map((cue) => row(cue)))}</ol>
    </section>}
  </div>;
}
