import { useEffect, useState } from "react";
import { actorScriptSchema, scriptCuesSchema, scriptParagraphs, type ActorScript, type ScriptCue, type TabletScript } from "@entertheblackbox/scenario";
import type { Phase } from "./model.js";

const preview = (paragraph: string) => {
  const line = paragraph.replace(/\s+/g, " ");
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

/** Show-level actor script. Blank lines separate the paragraphs that scene cues jump to. */
export function ActorScriptEditor({ script, groups = [], onChange }: { script: ActorScript | undefined; groups?: { id: string; label: string }[]; onChange: (script: ActorScript | undefined) => void }) {
  // Keep edits local while the text is invalid so typing never loses characters.
  const [draft, setDraft] = useState<ActorScript>(script ?? { title: "", text: "" });
  // Follow undo, redo and draft switches; an invalid in-progress edit only yields to a real change.
  useEffect(() => {
    setDraft((current) => script
      ? (current.title === script.title && current.text === script.text ? current : script)
      : (actorScriptSchema.safeParse(current).success ? { title: "", text: "" } : current));
  }, [script]);
  const check = actorScriptSchema.safeParse(draft);
  const count = scriptParagraphs(draft.text).length;
  const update = (next: ActorScript) => {
    setDraft(next);
    if (actorScriptSchema.safeParse(next).success) onChange(next);
  };
  return <fieldset><legend>Actor script <small>actorScript</small></legend>
    <p className="sc-tool-copy">Plain text for the read-only actor reader. Blank lines separate paragraphs; scene script cues jump the shared reader to a paragraph. It publishes with the show and loads automatically.</p>
    <p className="sc-tool-copy field-hint">Anyone who can open this Studio draft can read the script.</p>
    <label className="sc-tool-label"><span>Script title</span><input className="sc-tool-field" maxLength={160} value={draft.title} onChange={(event) => update({ ...draft, title: event.target.value })} /></label>
    <label className="sc-tool-label"><span>Script text · {count} paragraphs</span><textarea className="sc-tool-field" rows={10} maxLength={200_000} value={draft.text} onChange={(event) => update({ ...draft, text: event.target.value })} /></label>
    {!check.success && (draft.title || draft.text) && <p className="field-error" role="alert">{check.error.issues.map((issue) => issue.message).join("; ")}</p>}
    {groups.length > 0 && <details open={Object.keys(draft.speakersByGroup ?? {}).length > 0 || undefined}><summary>Speakers on tablets</summary>
      <p className="sc-tool-copy field-hint">Name each group's speaker exactly as the script writes it before the colon (e.g. VECTOR). Scenes with a tablet script highlight that speaker's lines on the group's tablets.</p>
      {groups.map((group) => <label key={group.id} className="sc-tool-label"><span>{group.label}</span><input className="sc-tool-field" maxLength={60} placeholder="No highlighted lines"
        value={draft.speakersByGroup?.[group.id] ?? ""} onChange={(event) => {
          const speakers = { ...draft.speakersByGroup };
          if (event.target.value.trim()) speakers[group.id] = event.target.value; else delete speakers[group.id];
          const { speakersByGroup: _, ...rest } = draft;
          update(Object.keys(speakers).length ? { ...rest, speakersByGroup: speakers } : rest);
        }} /></label>)}
    </details>}
    {script && <button className="sc-tool-button" type="button" onClick={() => { setDraft({ title: "", text: "" }); onChange(undefined); }}>Remove actor script</button>}
  </fieldset>;
}

/** Timed jumps of the shared actor reader during one scene. */
export function ScriptCueEditor({ phase, script, onChange }: { phase: Phase; script: ActorScript | undefined; onChange: (phase: Phase) => void }) {
  const cues = phase.scriptCues ?? [];
  const paragraphs = script ? scriptParagraphs(script.text) : [];
  const set = (next: ScriptCue[]) => onChange({ ...phase, scriptCues: next.length ? next : undefined });
  const check = scriptCuesSchema.safeParse(cues);
  if (!script && cues.length === 0) return <fieldset><legend>Actor script cues</legend><p className="sc-tool-copy">Add an actor script in Show properties (click empty canvas) to cue it from scenes.</p></fieldset>;
  return <fieldset><legend>Actor script cues <small>scriptCues</small></legend>
    <p className="sc-tool-copy">Moves every actor reader to a paragraph. Times are milliseconds from scene start. Operators can still move the cue in Admin; the next scene cue takes over again.</p>
    {!check.success && <p className="field-error" role="alert">{check.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}</p>}
    {cues.map((cue, index) => <fieldset key={index}><legend>Script cue {index + 1}</legend>
      <label className="sc-tool-label">Start (ms)<input className="sc-tool-field" type="number" min="0" step="1" value={cue.startMs} onChange={(event) => set(cues.map((old, i) => i === index ? { ...old, startMs: Math.max(0, Math.floor(Number(event.target.value) || 0)) } : old))} /></label>
      <label className="sc-tool-label">Paragraph<select className="sc-tool-select" value={cue.paragraph} onChange={(event) => set(cues.map((old, i) => i === index ? { ...old, paragraph: Number(event.target.value) } : old))}>
        {cue.paragraph >= paragraphs.length && <option value={cue.paragraph}>{cue.paragraph + 1} — missing from script</option>}
        {paragraphs.map((paragraph, i) => <option key={i} value={i}>{i + 1} — {preview(paragraph)}</option>)}
      </select></label>
      {cue.paragraph >= paragraphs.length && <p className="field-error" role="alert">Paragraph {cue.paragraph + 1} is not in the actor script.</p>}
      <button className="sc-tool-button" type="button" onClick={() => set(cues.filter((_, i) => i !== index))}>Remove script cue</button>
    </fieldset>)}
    <button className="sc-tool-button" type="button" disabled={!paragraphs.length || cues.length >= 64} onClick={() => {
      const last = cues[cues.length - 1];
      set([...cues, { startMs: last ? last.startMs + 5000 : 0, paragraph: last ? Math.min(last.paragraph + 1, paragraphs.length - 1) : 0 }]);
    }}>Add script cue</button>
  </fieldset>;
}

/** Shows part of the actor script on participants' tablets for one scene. */
export function TabletScriptEditor({ phase, script, groups, onChange }: { phase: Phase; script: ActorScript | undefined; groups: { id: string; label: string }[]; onChange: (phase: Phase) => void }) {
  if (phase.kind === "idle" || phase.kind === "group-branch") return null;
  const value = phase.tabletScript;
  const paragraphs = script ? scriptParagraphs(script.text) : [];
  const set = (next: TabletScript | undefined) => { const { tabletScript: _, ...rest } = phase; onChange((next ? { ...rest, tabletScript: next } : rest) as Phase); };
  if (!script && !value) return <fieldset><legend>Tablet script</legend><p className="sc-tool-copy">Add an actor script in Show properties (click empty canvas) to show it on tablets.</p></fieldset>;
  const select = (label: string, key: "fromParagraph" | "toParagraph") => <label className="sc-tool-label">{label}<select className="sc-tool-select" value={value![key]}
    onChange={(event) => { const n = Number(event.target.value); set(key === "fromParagraph" ? { ...value!, fromParagraph: n, toParagraph: Math.max(n, value!.toParagraph) } : { ...value!, toParagraph: n, fromParagraph: Math.min(n, value!.fromParagraph) }); }}>
    {value![key] >= paragraphs.length && <option value={value![key]}>{value![key] + 1} — missing from script</option>}
    {paragraphs.map((paragraph, i) => <option key={i} value={i}>{i + 1} — {preview(paragraph)}</option>)}
  </select></label>;
  return <fieldset><legend>Tablet script <small>tabletScript</small></legend>
    <p className="sc-tool-copy">Shows these script paragraphs on the tablets of the chosen groups for the whole scene, with each group's speaker lines highlighted. Only those tablets receive the text.</p>
    {!value ? <button className="sc-tool-button" type="button" disabled={!paragraphs.length} onClick={() => set({ fromParagraph: 0, toParagraph: paragraphs.length - 1, groupIds: [] })}>Show script on tablets</button> : <>
      {select("From paragraph", "fromParagraph")}
      {select("To paragraph", "toParagraph")}
      {value.toParagraph >= paragraphs.length && <p className="field-error" role="alert">Paragraph {value.toParagraph + 1} is not in the actor script.</p>}
      <p className="sc-tool-copy field-hint">{value.groupIds.length ? "Only these groups see it:" : "No group selected: every participant sees it."}</p>
      {groups.map((group) => <label key={group.id} className="sc-tool-checkbox"><input type="checkbox" checked={value.groupIds.includes(group.id)}
        onChange={(event) => set({ ...value, groupIds: event.target.checked ? [...value.groupIds, group.id] : value.groupIds.filter((id) => id !== group.id) })} /><span>{group.label}</span></label>)}
      <button className="sc-tool-button" type="button" onClick={() => set(undefined)}>Remove tablet script</button>
    </>}
  </fieldset>;
}
