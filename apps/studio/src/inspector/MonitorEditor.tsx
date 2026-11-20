import { MONITOR_IDS, MONITOR_TEXT_COLOR_PRESETS, monitorCuesSchema, type MonitorCue, type MonitorId } from "../../../../packages/scenario/src/monitors.js";
import type { Phase } from "./model.js";

export type MonitorMediaTarget = { monitorId: MonitorId; cueIndex: number };
export type MediaTarget = "src" | "audioSrc" | "extraAudioSrc" | "loopVideoSrc" | "phoneAudioSrc" | MonitorMediaTarget | { groupId: string };

export function MonitorEditor({ phase, onChange, onChooseMedia }: {
  phase: Phase;
  onChange: (phase: Phase) => void;
  onChooseMedia: (phaseId: string, target: MediaTarget, kind: "image" | "video", trigger: HTMLButtonElement) => void;
}) {
  const set = (id: MonitorId, cues: MonitorCue[]) => onChange({ ...phase, monitorCues: { ...phase.monitorCues, [id]: cues } });
  const check = monitorCuesSchema.safeParse(phase.monitorCues ?? {});
  return <fieldset><legend>Stage monitors</legend>
    <p className="sc-tool-copy">Text, images or muted video on M1–M4.</p>
    <details><summary>Cue timing help</summary><p className="sc-tool-copy">Times are milliseconds from scene start. Each cue replaces the previous one. Leave duration empty to hold until the next cue or scene. The optional final countdown ends at the next cue or duration, whichever comes first; a cue with neither has no deadline. Countdowns replace the text, centred in its colour, or keep it small underneath when ticked; image and video cues never count down. Screens without cues stay black. Monitors follow the main timeline, including during group paths.</p></details>
    {!check.success && <p className="field-error" role="alert">{check.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}</p>}
    {MONITOR_IDS.map((id) => {
      const cues = phase.monitorCues?.[id] ?? [];
      const update = (index: number, cue: MonitorCue) => set(id, cues.map((old, i) => i === index ? cue : old));
      return <details key={id}><summary>{id} · {cues.length} cues</summary>
        {cues.map((cue, index) => <fieldset key={index}><legend>{id} cue {index + 1}</legend>
          <label className="sc-tool-label">Content<select className="sc-tool-select" value={cue.kind} onChange={(event) => {
            const kind = event.target.value as MonitorCue["kind"];
            const timing = { startMs: cue.startMs, countdownSeconds: cue.countdownSeconds, countdownShowsText: cue.countdownShowsText, ...(cue.durationMs === undefined ? {} : { durationMs: cue.durationMs }) };
            const colored = { ...timing, ...("color" in cue && cue.color !== undefined ? { color: cue.color } : {}) };
            update(index, kind === "video" ? { kind, src: "choose-video.mp4", loop: false, fit: "contain", ...timing }
              : kind === "image" ? { kind, src: "choose-image.png", fit: "contain", ...colored }
              : kind === "vote-result" ? { kind, fallbackText: "", ...colored }
              : kind === "blank" ? { kind, ...timing } : { kind, text: "text" in cue ? cue.text ?? "" : "Content to come", ...colored });
          }}>{["placeholder", "text", "vote-result", "image", "video", "blank"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label className="sc-tool-label">Start (ms)<input className="sc-tool-field" type="number" min="0" step="1" value={cue.startMs} onChange={(event) => update(index, { ...cue, startMs: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
          <label className="sc-tool-label">Duration (ms, empty = hold)<input className="sc-tool-field" type="number" min="1" step="1" value={cue.durationMs ?? ""} onChange={(event) => update(index, { ...cue, durationMs: event.target.value === "" ? undefined : Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></label>
          {(cue.kind === "text" || cue.kind === "vote-result" || cue.kind === "placeholder") && <label className="sc-tool-label">Final countdown (seconds, empty = scene/vote)<input className="sc-tool-field" type="number" min="1" step="1" placeholder="5" value={cue.countdownSeconds ?? ""} onChange={(event) => update(index, { ...cue, countdownSeconds: event.target.value === "" ? undefined : Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></label>}
          {(cue.kind === "text" || cue.kind === "vote-result" || cue.kind === "placeholder") && <label className="sc-tool-label"><input type="checkbox" checked={cue.countdownShowsText ?? false} onChange={(event) => update(index, { ...cue, countdownShowsText: event.target.checked || undefined })} /> Keep text small under the countdown</label>}
          {cue.kind === "vote-result" && <>
            <label className="sc-tool-label">Vote scene ID (empty = most recent)<input className="sc-tool-field" value={cue.votePhaseId ?? ""} onChange={(event) => update(index, { ...cue, votePhaseId: event.target.value || undefined })} /></label>
            <label className="sc-tool-label">Fallback (tie, empty or unresolved vote)<textarea className="sc-tool-field" value={cue.fallbackText} onChange={(event) => update(index, { ...cue, fallbackText: event.target.value })} /></label>
          </>}
          {(cue.kind === "text" || cue.kind === "placeholder" || cue.kind === "image") && <label className="sc-tool-label">{cue.kind === "image" ? "Caption (optional)" : "Text"}<textarea className="sc-tool-field" value={cue.text ?? ""} onChange={(event) => update(index, { ...cue, text: event.target.value })} /></label>}
          {(cue.kind === "text" || cue.kind === "placeholder" || cue.kind === "vote-result" || cue.kind === "image") &&
            <MonitorColorField value={cue.color} onChange={(color) => update(index, { ...cue, color })} />}
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

/** Text colour for one cue: automatic (vote colour, else white), a show preset, or a custom hex. */
export function MonitorColorField({ value, onChange }: { value: string | undefined; onChange: (color: string | undefined) => void }) {
  const preset = MONITOR_TEXT_COLOR_PRESETS.find((item) => item.color === value?.toLowerCase());
  const choice = value === undefined ? "auto" : preset ? preset.color : "custom";
  return <div className="monitor-color-field">
    <label className="sc-tool-label">Text colour<select className="sc-tool-select" value={choice} onChange={(event) => {
      const next = event.target.value;
      onChange(next === "auto" ? undefined : next === "custom" ? value ?? "#ffffff" : next);
    }}>
      <option value="auto">Automatic (vote colour, else white)</option>
      {MONITOR_TEXT_COLOR_PRESETS.map((item) => <option key={item.color} value={item.color}>{item.name}</option>)}
      <option value="custom">Custom…</option>
    </select></label>
    {value !== undefined && <input type="color" aria-label="Custom text colour" value={value.toLowerCase()} onChange={(event) => onChange(event.target.value)} />}
  </div>;
}
