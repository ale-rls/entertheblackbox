import { surfaceCueEffectSchema, surfaceCuesSchema, type SurfaceCue, type SurfaceCueEffect } from "@entertheblackbox/scenario";

const KINDS = surfaceCueEffectSchema.shape.kind.options;
const KIND_LABEL: Record<SurfaceCueEffect["kind"], string> = { chase: "Chase", breathe: "Breathe", wave: "Wave", gradient: "Gradient wave", rainbow: "Rainbow", chaos: "Chaos" };
const NEW_EFFECT: SurfaceCueEffect = { kind: "breathe", color: "#ffffff", periodMs: 2000 };
const seconds = (ms: number) => Math.round(ms / 100) / 10;

/**
 * Timed Admin Instrument effects on the joined tablets for a video or narration scene.
 * The server plays them in tablet-label order; the operator can take over in Admin.
 */
export function SurfaceCueEditor({ cues, sceneMs, onChange }: {
  cues: readonly SurfaceCue[] | undefined;
  sceneMs: number;
  onChange: (cues: SurfaceCue[] | undefined) => void;
}) {
  const list = cues ?? [];
  const set = (next: SurfaceCue[]) => onChange(next.length ? next : undefined);
  const update = (index: number, cue: SurfaceCue) => set(list.map((old, i) => i === index ? cue : old));
  const check = surfaceCuesSchema.safeParse(list);
  return <fieldset><legend>Tablet lights</legend>
    <p className="sc-tool-copy field-hint">Plays Instrument effects on every joined tablet, in label order, timed from the scene start. An effect keeps running into later scenes until a stop cue, the operator, or the end of the show. Starting or stopping an effect in Admin takes over from this scene's remaining cues.</p>
    {!check.success && <p className="field-error" role="alert">{check.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}</p>}
    {list.map((cue, index) => {
      const effect = cue.action === "start" ? cue.effect : null;
      const setEffect = (change: Partial<SurfaceCueEffect>) => effect && update(index, { ...cue, action: "start", effect: { ...effect, ...change } });
      return <fieldset key={index}><legend>Light cue {index + 1}</legend>
        <label className="sc-tool-label"><span title="surfaceCues[].atMs">At (seconds from scene start)</span><input className="sc-tool-field" type="number" min="0" step="0.1" value={seconds(cue.atMs)} onChange={(event) => { if (event.target.value !== "") update(index, { ...cue, atMs: Math.max(0, Math.round(Number(event.target.value) * 1000)) }); }} /></label>
        {cue.atMs > sceneMs && <p className="field-error" role="alert">This cue is after the scene ends ({seconds(sceneMs)} s).</p>}
        <label className="sc-tool-label"><span title="surfaceCues[].action / effect.kind">Light</span><select className="sc-tool-select" value={effect ? effect.kind : "stop"} onChange={(event) => {
          const value = event.target.value;
          update(index, value === "stop" ? { atMs: cue.atMs, action: "stop" } : { atMs: cue.atMs, action: "start", effect: { ...(effect ?? NEW_EFFECT), kind: value as SurfaceCueEffect["kind"] } });
        }}>{KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}<option value="stop">Stop (back to resting colour)</option></select></label>
        {effect && <>
          {effect.kind !== "rainbow" && <label className="sc-tool-label"><span title="effect.color">Colour</span><input className="sc-tool-field" type="color" value={effect.color} onChange={(event) => setEffect({ color: event.target.value })} /></label>}
          {effect.kind === "gradient" && <label className="sc-tool-label"><span title="effect.color2">Second colour</span><input className="sc-tool-field" type="color" value={effect.color2 ?? effect.color} onChange={(event) => setEffect({ color2: event.target.value })} /></label>}
          <label className="sc-tool-label"><span title="effect.periodMs">Cycle (seconds, smaller = faster)</span><input className="sc-tool-field" type="number" min="0.2" max="60" step="0.1" value={seconds(effect.periodMs)} onChange={(event) => { if (event.target.value !== "") setEffect({ periodMs: Math.min(60_000, Math.max(200, Math.round(Number(event.target.value) * 1000))) }); }} /></label>
          <label className="sc-tool-label"><span title="effect.brightness">Brightness (%)</span><input className="sc-tool-field" type="number" min="0" max="100" step="5" value={Math.round((effect.brightness ?? 1) * 100)} onChange={(event) => { if (event.target.value !== "") setEffect({ brightness: Math.min(1, Math.max(0, Number(event.target.value) / 100)) }); }} /></label>
        </>}
        <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => set(list.filter((_, i) => i !== index))}>Remove light cue {index + 1}</button>
      </fieldset>;
    })}
    <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => set([...list, { atMs: list.at(-1)?.atMs ?? 0, action: "start", effect: NEW_EFFECT }])}>Add light cue</button>
  </fieldset>;
}
