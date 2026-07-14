import { useEffect, useState } from "react";
import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { compiledJson, phaseIdError, type AuthorablePhaseKind, type Phase } from "./model.js";

type Props = {
  project: StudioProject;
  selectedId: string | undefined;
  localMedia: Array<{ src: string; durationMs?: number }>;
  onRename: (nextId: string) => void;
  onChange: (phase: Phase) => void;
  onKindChange: (kind: AuthorablePhaseKind, trigger: HTMLSelectElement) => void;
  onTransitionChange: (kind: "fixed" | "quadrant-plurality", trigger: HTMLSelectElement) => void;
  onQuestionLayoutChange: (layout: "four-quadrant" | "two-quadrant-x" | "two-quadrant-y", trigger: HTMLSelectElement) => void;
};

const numberValue = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export function Inspector({ project, selectedId, localMedia, onRename, onChange, onKindChange, onTransitionChange, onQuestionLayoutChange }: Props) {
  const phase = project.scenario.phases.find((item) => item.id === selectedId);
  const [idInput, setIdInput] = useState(phase?.id ?? "");
  useEffect(() => setIdInput(phase?.id ?? ""), [phase?.id]);
  const idProblem = phase ? phaseIdError(project, phase.id, idInput) : undefined;
  const detectedDuration = phase?.kind === "video"
    ? localMedia.find((file) => file.src === phase.src)?.durationMs
    : undefined;

  if (!phase) return <aside className="inspector" aria-label="Properties inspector"><h2>Properties</h2><p className="sc-tool-copy">Select a runtime phase to edit it.</p><Compiled project={project} /></aside>;
  const label = (plain: string, runtime: string) => <span>{plain}<small>{runtime}</small></span>;
  const text = (plain: string, runtime: string, value: string, change: (value: string) => void) => <label className="sc-tool-label">{label(plain, runtime)}<input className="sc-tool-field" value={value} onChange={(event) => change(event.target.value)} /></label>;
  const number = (plain: string, runtime: string, value: number, change: (value: number) => void) => <label className="sc-tool-label">{label(plain, runtime)}<input className="sc-tool-field" type="number" min="0" value={value} onChange={(event) => change(numberValue(event.target.value, value))} /></label>;

  return <aside className="inspector" aria-label="Properties inspector"><h2>Properties</h2>
    <label className="sc-tool-label">{label("Runtime ID", "id")}<input className="sc-tool-field" aria-invalid={Boolean(idProblem)} value={idInput} onChange={(event) => setIdInput(event.target.value)} onBlur={() => { if (!idProblem && idInput !== phase.id) onRename(idInput); }} /></label>
    {idProblem && <p className="field-error" role="alert">{idProblem}</p>}
    {phase.kind !== "idle" && <label className="sc-tool-label">{label("Phase type", "kind")}<select className="sc-tool-select" value={phase.kind} onChange={(event) => onKindChange(event.target.value as AuthorablePhaseKind, event.currentTarget)}><option value="video">Video</option><option value="position-question">Position question</option></select></label>}
    {phase.kind === "video" && <>
      <label className="sc-tool-label">{label("Media source", "src")}<input className="sc-tool-field" list="studio-media-sources" value={phase.src} onChange={(event) => {
        const src = event.target.value;
        const expectedDurationMs = localMedia.find((file) => file.src === src)?.durationMs;
        onChange({ ...phase, src, ...(expectedDurationMs === undefined ? {} : { expectedDurationMs }) });
      }} /><datalist id="studio-media-sources">{project.manifest.files.map((file) => <option key={file.src} value={file.src} />)}</datalist></label>
      {number("Expected duration (ms)", "expectedDurationMs", phase.expectedDurationMs, (expectedDurationMs) => onChange({ ...phase, expectedDurationMs }))}
      {detectedDuration !== undefined && <p className="sc-tool-copy field-hint">Detected from video: {(detectedDuration / 1000).toFixed(3)} seconds</p>}
    </>}
    {phase.kind === "position-question" && <>
      {text("Question", "text", phase.text, (value) => onChange({ ...phase, text: value }))}
      <label className="sc-tool-label">{label("Quadrant layout", "field.type")}<select className="sc-tool-select" value={phase.field.type === "four-quadrant" ? "four-quadrant" : `two-quadrant-${phase.field.axis}`} onChange={(event) => onQuestionLayoutChange(event.target.value as "four-quadrant" | "two-quadrant-x" | "two-quadrant-y", event.currentTarget)}><option value="four-quadrant">Four quadrants · X + Y axes</option><option value="two-quadrant-x">Two quadrants · left / right</option><option value="two-quadrant-y">Two quadrants · top / bottom</option></select></label>
      {phase.field.type === "four-quadrant" ? (() => {
        const field = phase.field;
        return <>
          {text("X axis minimum", "field.xAxis.minLabel", field.xAxis.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, xAxis: { ...field.xAxis, minLabel } } } as Phase))}
          {text("X axis maximum", "field.xAxis.maxLabel", field.xAxis.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, xAxis: { ...field.xAxis, maxLabel } } } as Phase))}
          {text("Y axis minimum", "field.yAxis.minLabel", field.yAxis.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, yAxis: { ...field.yAxis, minLabel } } } as Phase))}
          {text("Y axis maximum", "field.yAxis.maxLabel", field.yAxis.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, yAxis: { ...field.yAxis, maxLabel } } } as Phase))}
        </>;
      })() : (() => {
        const field = phase.field;
        return <>
          {text(`${field.axis === "x" ? "Left" : "Top"} quadrant`, "field.labels.minLabel", field.labels.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, labels: { ...field.labels, minLabel } } } as Phase))}
          {text(`${field.axis === "x" ? "Right" : "Bottom"} quadrant`, "field.labels.maxLabel", field.labels.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, labels: { ...field.labels, maxLabel } } } as Phase))}
        </>;
      })()}
      {number("Question duration (ms)", "durationMs", phase.durationMs, (durationMs) => onChange({ ...phase, durationMs }))}
      {number("Outcome freeze (ms)", "freezeMs", phase.freezeMs, (freezeMs) => onChange({ ...phase, freezeMs }))}
      {number("Connection stale after (ms)", "connectionStaleAfterMs", phase.connectionStaleAfterMs, (connectionStaleAfterMs) => onChange({ ...phase, connectionStaleAfterMs }))}
      <label className="sc-tool-checkbox check"><input type="checkbox" checked={phase.showLiveCounts} onChange={(event) => onChange({ ...phase, showLiveCounts: event.target.checked })} />{label("Show live quadrant counts", "showLiveCounts")}</label>
      <label className="sc-tool-label">{label("Transition rule", "next.type")}<select className="sc-tool-select" value={phase.next.type} onChange={(event) => onTransitionChange(event.target.value as "fixed" | "quadrant-plurality", event.currentTarget)}><option value="fixed">Fixed target</option><option value="quadrant-plurality">Quadrant plurality</option></select></label>
      {phase.next.type === "quadrant-plurality" && <CountedStatuses phase={phase} onChange={onChange} />}
    </>}
    <Compiled project={project} />
  </aside>;
}

function CountedStatuses({ phase, onChange }: { phase: Extract<Phase, { kind: "position-question" }>; onChange: (phase: Phase) => void }) {
  if (phase.next.type !== "quadrant-plurality") return null;
  const next = phase.next;
  return <fieldset><legend>Count participant states <small>next.countedStatuses</small></legend>{(["valid", "stale", "disconnected"] as const).map((status) => <label className="sc-tool-checkbox check" key={status}><input type="checkbox" checked={next.countedStatuses.includes(status)} onChange={(event) => {
    const values = event.target.checked ? [...next.countedStatuses, status] : next.countedStatuses.filter((item) => item !== status);
    if (values.length === 0) return;
    if (phase.field.type === "four-quadrant") {
      onChange({ ...phase, next: { ...next, countedStatuses: values as typeof next.countedStatuses } } as Phase);
    } else {
      onChange({ ...phase, next: { ...next, countedStatuses: values as typeof next.countedStatuses } } as Phase);
    }
  }} />{status}</label>)}</fieldset>;
}

function Compiled({ project }: { project: StudioProject }) {
  return <details><summary>Compiled scenario JSON (read only)</summary><pre>{compiledJson(project)}</pre></details>;
}
