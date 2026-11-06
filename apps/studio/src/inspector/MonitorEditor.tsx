import { MONITOR_IDS, monitorCuesSchema, type MonitorCue, type MonitorId } from "../../../../packages/scenario/src/monitors.js";
import type { Phase } from "./model.js";

export type MonitorMediaTarget = { monitorId: MonitorId; cueIndex: number };
export type MediaTarget = "src" | "audioSrc" | "extraAudioSrc" | "phoneAudioSrc" | MonitorMediaTarget | { groupId: string };

export function MonitorEditor({ phase, onChange, onChooseMedia }: {
  phase: Phase;
  onChange: (phase: Phase) => void;
  onChooseMedia: (phaseId: string, target: MediaTarget, kind: "image" | "video", trigger: HTMLButtonElement) => void;
}) {
  const set = (id: MonitorId, cues: MonitorCue[]) => onChange({ ...phase, monitorCues: { ...phase.monitorCues, [id]: cues } });
  const check = monitorCuesSchema.safeParse(phase.monitorCues ?? {});
  return <fieldset><legend>Stage monitors</legend>
    <p className="sc-tool-copy">Text, images or muted video on M1–M4.</p>
    <details><summary>Cue timing help</summary><p className="sc-tool-copy">Times are milliseconds from scene start. Each cue replaces the previous one. Leave duration empty to hold until the next cue or scene. Screens without cues stay black. Monitors follow the main timeline, including during group paths.</p></details>
    {!check.success && <p className="field-error" role="alert">{check.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}</p>}
    {MONITOR_IDS.map((id) => {
      const cues = phase.monitorCues?.[id] ?? [];
      const update = (index: number, cue: MonitorCue) => set(id, cues.map((old, i) => i === index ? cue : old));
      return <details key={id}><summary>{id} · {cues.length} cues</summary>
        {cues.map((cue, index) => <fieldset key={index}><legend>{id} cue {index + 1}</legend>
          <label className="sc-tool-label">Content<select className="sc-tool-select" value={cue.kind} onChange={(event) => {
            const kind = event.target.value as MonitorCue["kind"];
            const timing = { startMs: cue.startMs, ...(cue.durationMs === undefined ? {} : { durationMs: cue.durationMs }) };
            update(index, kind === "video" ? { kind, src: "choose-video.mp4", loop: false, fit: "contain", ...timing }
              : kind === "image" ? { kind, src: "choose-image.png", fit: "contain", ...timing }
              : kind === "blank" ? { kind, ...timing } : { kind, text: "text" in cue ? cue.text ?? "" : "Content to come", ...timing });
          }}>{["placeholder", "text", "image", "video", "blank"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label className="sc-tool-label">Start (ms)<input className="sc-tool-field" type="number" min="0" step="1" value={cue.startMs} onChange={(event) => update(index, { ...cue, startMs: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
          <label className="sc-tool-label">Duration (ms, empty = hold)<input className="sc-tool-field" type="number" min="1" step="1" value={cue.durationMs ?? ""} onChange={(event) => update(index, { ...cue, durationMs: event.target.value === "" ? undefined : Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></label>
          {(cue.kind === "text" || cue.kind === "placeholder" || cue.kind === "image") && <label className="sc-tool-label">{cue.kind === "image" ? "Caption (optional)" : "Text"}<textarea className="sc-tool-field" value={cue.text ?? ""} onChange={(event) => update(index, { ...cue, text: event.target.value })} /></label>}
          {(cue.kind === "video" || cue.kind === "image") && <>
            <button className="sc-tool-button" type="button" onClick={(event) => onChooseMedia(phase.id, { monitorId: id, cueIndex: index }, cue.kind, event.currentTarget)}>Browse {cue.kind} library… {cue.src}</button>
            <label className="sc-tool-label">Fit<select className="sc-tool-select" value={cue.fit} onChange={(event) => update(index, { ...cue, fit: event.target.value as "contain" | "cover" })}><option value="contain">Fit whole frame</option><option value="cover">Fill screen (crop)</option></select></label>
          </>}
          {cue.kind === "video" && <label className="sc-tool-checkbox"><input type="checkbox" checked={cue.loop} onChange={(event) => update(index, { ...cue, loop: event.target.checked })} />Loop video on server clock</label>}
          <button className="sc-tool-button" type="button" onClick={() => set(id, cues.filter((_, i) => i !== index))}>Remove cue</button>
        </fieldset>)}
        <button className="sc-tool-button" type="button" disabled={cues.length >= 64} onClick={() => set(id, [...cues, { kind: "placeholder", text: `${id} — content to come`, startMs: cues.length ? cues[cues.length - 1]!.startMs + (cues[cues.length - 1]!.durationMs ?? 5000) : 0 }])}>Add {id} cue</button>
      </details>;
    })}
  </fieldset>;
}
