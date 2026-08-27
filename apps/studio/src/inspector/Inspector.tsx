import { useEffect, useState } from "react";
import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { compiledJson, phaseIdError, type AuthorablePhaseKind, type Phase } from "./model.js";
import { studioMediaKindForSource, type StudioMediaKind } from "../media/library.js";

type Props = {
  project: StudioProject;
  selectedId: string | undefined;
  localMedia: Array<{ src: string; durationMs?: number }>;
  onRename: (nextId: string) => void;
  onChange: (phase: Phase) => void;
  onChooseMedia: (phaseId: string, target: "src" | "audioSrc", mediaKind: Exclude<StudioMediaKind, "unknown">, trigger: HTMLButtonElement) => void;
  onKindChange: (kind: AuthorablePhaseKind, trigger: HTMLSelectElement) => void;
  onTransitionChange: (kind: "fixed" | "quadrant-plurality", trigger: HTMLSelectElement) => void;
  onQuestionLayoutChange: (layout: "four-quadrant" | "two-quadrant-x" | "two-quadrant-y", trigger: HTMLSelectElement) => void;
  onTargetAudienceSizeChange: (value: number) => void;
};

const numberValue = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export function Inspector({ project, selectedId, localMedia, onRename, onChange, onChooseMedia, onKindChange, onTransitionChange, onQuestionLayoutChange, onTargetAudienceSizeChange }: Props) {
  const phase = project.scenario.phases.find((item) => item.id === selectedId);
  const [idInput, setIdInput] = useState(phase?.id ?? "");
  useEffect(() => setIdInput(phase?.id ?? ""), [phase?.id]);
  const idProblem = phase ? phaseIdError(project, phase.id, idInput) : undefined;
  const detectedDuration = phase?.kind === "video" || phase?.kind === "video-position-question"
    ? localMedia.find((file) => file.src === (phase.audioSrc ?? phase.src))?.durationMs
    : undefined;

  if (!phase) return <aside className="inspector" aria-label="Properties inspector"><h2>Properties</h2><p className="sc-tool-copy">Select a runtime phase to edit it.</p>
    <label className="sc-tool-label"><span>Ghost cursor fill target<small>targetAudienceSize</small></span><input className="sc-tool-field" type="number" min="0" value={project.scenario.targetAudienceSize ?? 0} onChange={(event) => onTargetAudienceSizeChange(numberValue(event.target.value, project.scenario.targetAudienceSize ?? 0))} /></label>
    <p className="sc-tool-copy field-hint">Live + replayed past-participant cursors are topped up to this count on display. 0 disables ghost cursors.</p>
    <Compiled project={project} /></aside>;
  const label = (plain: string, runtime: string) => <span>{plain}<small>{runtime}</small></span>;
  const text = (plain: string, runtime: string, value: string, change: (value: string) => void) => <label className="sc-tool-label">{label(plain, runtime)}<input className="sc-tool-field" value={value} onChange={(event) => change(event.target.value)} /></label>;
  const number = (plain: string, runtime: string, value: number, change: (value: number) => void) => <label className="sc-tool-label">{label(plain, runtime)}<input className="sc-tool-field" type="number" min="0" value={value} onChange={(event) => change(numberValue(event.target.value, value))} /></label>;
  const mediaPicker = (plain: string, runtime: "src" | "audioSrc", src: string, kind: Exclude<StudioMediaKind, "unknown">) => <>
    <div className="sc-tool-label media-source-field">{label(plain, runtime)}<button className="sc-tool-button media-source-picker" data-sc-tool-variant="secondary" type="button" aria-label={`Choose ${kind} for ${phase.id}. Current media: ${src}`} onClick={(event) => onChooseMedia(phase.id, runtime, kind, event.currentTarget)}>
      <span className="sc-tool-mono">{src}</span><span>Browse library…</span>
    </button></div>
    {!localMedia.some((file) => file.src === src) && <p className="field-error" role="alert">This file is missing from the shared media library. Choose a replacement.</p>}
  </>;

  return <aside className="inspector" aria-label="Properties inspector"><h2>Properties</h2>
    <label className="sc-tool-label">{label("Runtime ID", "id")}<input className="sc-tool-field" aria-invalid={Boolean(idProblem)} value={idInput} onChange={(event) => setIdInput(event.target.value)} onBlur={() => { if (!idProblem && idInput !== phase.id) onRename(idInput); }} /></label>
    {idProblem && <p className="field-error" role="alert">{idProblem}</p>}
    {phase.kind !== "idle" && <label className="sc-tool-label">{label("Phase type", "kind")}<select className="sc-tool-select" value={phase.kind} onChange={(event) => onKindChange(event.target.value as AuthorablePhaseKind, event.currentTarget)}><option value="video">Timed media</option><option value="position-question">Position question</option><option value="video-position-question">Timed media + position vote</option></select></label>}
    {phase.kind !== "idle" && <label className="sc-tool-checkbox check"><input type="checkbox" checked={phase.showCursors ?? true} onChange={(event) => onChange({ ...phase, showCursors: event.target.checked })} />{label("Show cursors", "showCursors")}</label>}
    {(phase.kind === "video" || phase.kind === "video-position-question") && <>
      {text("Title (optional)", "title", phase.title ?? "", (value) => onChange({ ...phase, title: value.trim() ? value : undefined }))}
      <label className="sc-tool-label">{label("Playback format", "src + audioSrc")}<select className="sc-tool-select" value={phase.audioSrc === undefined ? "video" : "image-audio"} onChange={(event) => {
        if (event.target.value === "video") {
          const current = studioMediaKindForSource(phase.src) === "video" ? phase.src : localMedia.find((file) => studioMediaKindForSource(file.src) === "video")?.src ?? "media/new-video.mp4";
          const expectedDurationMs = localMedia.find((file) => file.src === current)?.durationMs ?? phase.expectedDurationMs;
          onChange({ ...phase, src: current, audioSrc: undefined, expectedDurationMs });
          return;
        }
        const image = studioMediaKindForSource(phase.src) === "image" ? phase.src : localMedia.find((file) => studioMediaKindForSource(file.src) === "image")?.src ?? "media/new-image.jpg";
        const audio = phase.audioSrc ?? localMedia.find((file) => studioMediaKindForSource(file.src) === "audio")?.src ?? "media/new-audio.mp3";
        const expectedDurationMs = localMedia.find((file) => file.src === audio)?.durationMs ?? phase.expectedDurationMs;
        onChange({ ...phase, src: image, audioSrc: audio, expectedDurationMs });
      }}><option value="video">Video</option><option value="image-audio">Still image + MP3</option></select></label>
      {phase.audioSrc === undefined
        ? mediaPicker("Video", "src", phase.src, "video")
        : <>{mediaPicker("Still image", "src", phase.src, "image")}{mediaPicker("MP3 audio", "audioSrc", phase.audioSrc, "audio")}</>}
      <p className="sc-tool-copy field-hint">{detectedDuration === undefined
        ? "Playback duration is detected automatically from the video or MP3."
        : `Playback duration: ${(detectedDuration / 1000).toFixed(3)} seconds`}</p>
    </>}
    {(phase.kind === "position-question" || phase.kind === "video-position-question") && <>
      {phase.kind === "position-question" && text("Title (optional)", "title", phase.title ?? "", (value) => onChange({ ...phase, title: value.trim() ? value : undefined }))}
      {text("Question", "text", phase.text, (value) => onChange({ ...phase, text: value }))}
      {phase.field.type !== "polygon-zones" && <label className="sc-tool-label">{label("Quadrant layout", "field.type")}<select className="sc-tool-select" value={phase.field.type === "four-quadrant" ? "four-quadrant" : `two-quadrant-${phase.field.axis}`} onChange={(event) => onQuestionLayoutChange(event.target.value as "four-quadrant" | "two-quadrant-x" | "two-quadrant-y", event.currentTarget)}><option value="four-quadrant">Four quadrants · X + Y axes</option><option value="two-quadrant-x">Two quadrants · left / right</option><option value="two-quadrant-y">Two quadrants · top / bottom</option></select></label>}
      {phase.field.type === "four-quadrant" ? (() => {
        const field = phase.field;
        return <>
          {text("X axis minimum", "field.xAxis.minLabel", field.xAxis.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, xAxis: { ...field.xAxis, minLabel } } } as Phase))}
          {text("X axis maximum", "field.xAxis.maxLabel", field.xAxis.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, xAxis: { ...field.xAxis, maxLabel } } } as Phase))}
          {text("Y axis minimum", "field.yAxis.minLabel", field.yAxis.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, yAxis: { ...field.yAxis, minLabel } } } as Phase))}
          {text("Y axis maximum", "field.yAxis.maxLabel", field.yAxis.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, yAxis: { ...field.yAxis, maxLabel } } } as Phase))}
        </>;
      })() : phase.field.type === "two-quadrant" ? (() => {
        const field = phase.field;
        return <>
          {text(`${field.axis === "x" ? "Left" : "Top"} quadrant`, "field.labels.minLabel", field.labels.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, labels: { ...field.labels, minLabel } } } as Phase))}
          {text(`${field.axis === "x" ? "Right" : "Bottom"} quadrant`, "field.labels.maxLabel", field.labels.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, labels: { ...field.labels, maxLabel } } } as Phase))}
        </>;
      })() : (() => {
        const field = phase.field;
        return <p className="sc-tool-copy field-hint">
          Polygon zones ({field.zones.map((zone) => zone.label).join(", ")}) aren't editable here yet — edit the scenario JSON directly.
        </p>;
      })()}
      {phase.kind === "position-question" && <>
        {number("Question duration (ms)", "durationMs", phase.durationMs, (durationMs) => onChange({ ...phase, durationMs }))}
        {number("Outcome freeze (ms)", "freezeMs", phase.freezeMs, (freezeMs) => onChange({ ...phase, freezeMs }))}
      </>}
      {phase.kind === "video-position-question" && <fieldset className="timeline-fields"><legend>Vote timeline <small>milliseconds from media start</small></legend>
        {number("Show question", "showAtMs", phase.showAtMs, (showAtMs) => onChange({ ...phase, showAtMs }))}
        {number("Open voting", "openAtMs", phase.openAtMs, (openAtMs) => onChange({ ...phase, openAtMs }))}
        {number("Close voting", "closeAtMs", phase.closeAtMs, (closeAtMs) => onChange({ ...phase, closeAtMs }))}
        {number("Hide question", "hideAtMs", phase.hideAtMs, (hideAtMs) => onChange({ ...phase, hideAtMs }))}
        <p className="sc-tool-copy field-hint">Required order: show ≤ open &lt; close ≤ hide ≤ media duration ({phase.expectedDurationMs} ms).</p>
      </fieldset>}
      {number("Connection stale after (ms)", "connectionStaleAfterMs", phase.connectionStaleAfterMs, (connectionStaleAfterMs) => onChange({ ...phase, connectionStaleAfterMs }))}
      <label className="sc-tool-checkbox check"><input type="checkbox" checked={phase.showLiveCounts} onChange={(event) => onChange({ ...phase, showLiveCounts: event.target.checked })} />{label("Show live quadrant counts", "showLiveCounts")}</label>
      <label className="sc-tool-label">{label("Transition rule", "next.type")}<select className="sc-tool-select" value={phase.next.type} onChange={(event) => onTransitionChange(event.target.value as "fixed" | "quadrant-plurality", event.currentTarget)}><option value="fixed">Fixed target</option><option value="quadrant-plurality">Quadrant plurality</option></select></label>
      {phase.next.type === "quadrant-plurality" && <CountedStatuses phase={phase} onChange={onChange} />}
    </>}
    <Compiled project={project} />
  </aside>;
}

function CountedStatuses({ phase, onChange }: { phase: Extract<Phase, { kind: "position-question" | "video-position-question" }>; onChange: (phase: Phase) => void }) {
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
