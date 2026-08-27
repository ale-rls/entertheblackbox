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
  onQuestionLayoutChange: (layout: "four-quadrant" | "two-quadrant-x" | "two-quadrant-y" | "three-candidate-zones", trigger: HTMLSelectElement) => void;
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
  const audioDurationMs = (phase?.kind === "video" || phase?.kind === "video-position-question") && phase.audioSrc !== undefined
    ? detectedDuration ?? Math.max(1, phase.expectedDurationMs - (phase.tailDurationMs ?? 0))
    : undefined;

  if (!phase) return <aside className="inspector" aria-label="Properties inspector"><h2>Properties</h2><p className="sc-tool-copy">Select a runtime phase to edit it.</p>
    <label className="sc-tool-label"><span>Ghost cursor fill target<small>targetAudienceSize</small></span><input className="sc-tool-field" type="number" min="0" value={project.scenario.targetAudienceSize ?? 0} onChange={(event) => onTargetAudienceSizeChange(numberValue(event.target.value, project.scenario.targetAudienceSize ?? 0))} /></label>
    <p className="sc-tool-copy field-hint">Live + replayed past-participant cursors are topped up to this count on display. 0 disables ghost cursors.</p>
    <Compiled project={project} /></aside>;
  const label = (plain: string, runtime: string) => <span>{plain}<small>{runtime}</small></span>;
  const text = (plain: string, runtime: string, value: string, change: (value: string) => void) => <label className="sc-tool-label">{label(plain, runtime)}<input className="sc-tool-field" value={value} onChange={(event) => change(event.target.value)} /></label>;
  const number = (plain: string, runtime: string, value: number, change: (value: number) => void) => <label className="sc-tool-label">{label(plain, runtime)}<input className="sc-tool-field" type="number" min="0" value={value} onChange={(event) => change(numberValue(event.target.value, value))} /></label>;
  const boundedNumber = (plain: string, runtime: string, value: number, min: number, max: number, change: (value: number) => void) => <label className="sc-tool-label">{label(plain, runtime)}<input className="sc-tool-field" type="number" min={min} max={max} value={value} onChange={(event) => {
    const parsed = Number(event.target.value);
    change(Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value);
  }} /></label>;
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
          onChange({ ...phase, src: current, audioSrc: undefined, tailDurationMs: undefined, expectedDurationMs });
          return;
        }
        const image = studioMediaKindForSource(phase.src) === "image" ? phase.src : localMedia.find((file) => studioMediaKindForSource(file.src) === "image")?.src ?? "media/new-image.jpg";
        const audio = phase.audioSrc ?? localMedia.find((file) => studioMediaKindForSource(file.src) === "audio")?.src ?? "media/new-audio.mp3";
        const tailDurationMs = phase.tailDurationMs ?? (phase.kind === "video-position-question" ? 25_000 : 1_000);
        const mediaDurationMs = localMedia.find((file) => file.src === audio)?.durationMs ?? phase.expectedDurationMs;
        const expectedDurationMs = mediaDurationMs + tailDurationMs;
        onChange(phase.kind === "video-position-question"
          ? { ...phase, src: image, audioSrc: audio, tailDurationMs, expectedDurationMs, showAtMs: mediaDurationMs, openAtMs: mediaDurationMs, closeAtMs: mediaDurationMs + Math.max(1, Math.floor(tailDurationMs * .8)), hideAtMs: expectedDurationMs }
          : { ...phase, src: image, audioSrc: audio, tailDurationMs, expectedDurationMs });
      }}><option value="video">Video</option><option value="image-audio">Still image + MP3</option></select></label>
      {phase.audioSrc === undefined
        ? mediaPicker("Video", "src", phase.src, "video")
        : <>{mediaPicker("Still image", "src", phase.src, "image")}{mediaPicker("MP3 audio", "audioSrc", phase.audioSrc, "audio")}</>}
      <p className="sc-tool-copy field-hint">{detectedDuration === undefined
        ? "Playback duration is detected automatically from the video or MP3."
        : phase.audioSrc === undefined
          ? `Playback duration: ${(detectedDuration / 1000).toFixed(3)} seconds`
          : `Audio duration: ${(detectedDuration / 1000).toFixed(3)} seconds · total with tail: ${((detectedDuration + (phase.tailDurationMs ?? 0)) / 1000).toFixed(3)} seconds`}</p>
      {phase.audioSrc !== undefined && number("Tail after audio (ms)", "tailDurationMs", phase.tailDurationMs ?? 0, (tailDurationMs) => {
        const nextExpectedDurationMs = (audioDurationMs ?? 1) + tailDurationMs;
        if (phase.kind !== "video-position-question") {
          onChange({ ...phase, tailDurationMs, expectedDurationMs: nextExpectedDurationMs });
          return;
        }
        const showAtMs = Math.min(phase.showAtMs, nextExpectedDurationMs - 1);
        const openAtMs = Math.min(Math.max(phase.openAtMs, showAtMs), nextExpectedDurationMs - 1);
        const closeAtMs = Math.min(Math.max(phase.closeAtMs, openAtMs + 1), nextExpectedDurationMs);
        const hideAtMs = Math.min(Math.max(phase.hideAtMs, closeAtMs), nextExpectedDurationMs);
        onChange({ ...phase, tailDurationMs, expectedDurationMs: nextExpectedDurationMs, showAtMs, openAtMs, closeAtMs, hideAtMs });
      })}
      <label className="sc-tool-checkbox check"><input
        type="checkbox"
        checked={phase.rating !== undefined}
        onChange={(event) => onChange({
          ...phase,
          rating: event.target.checked
            ? { candidateLabel: phase.rating?.candidateLabel ?? phase.title ?? phase.id }
            : undefined,
        })}
      />{label("Applause + boo buttons", "rating")}</label>
      {phase.rating && text("Reaction subject", "rating.candidateLabel", phase.rating.candidateLabel, (candidateLabel) => onChange({
        ...phase,
        rating: { candidateLabel },
      }))}
      {phase.kind === "video-position-question" && phase.rating && <p className="sc-tool-copy field-hint">The phone keeps the regular spectrum trackpad active and shows applause/boo as secondary buttons.</p>}
    </>}
    {(phase.kind === "position-question" || phase.kind === "video-position-question") && <>
      {phase.kind === "position-question" && text("Title (optional)", "title", phase.title ?? "", (value) => onChange({ ...phase, title: value.trim() ? value : undefined }))}
      {text("Question", "text", phase.text, (value) => onChange({ ...phase, text: value }))}
      <label className="sc-tool-label">{label("Position layout", "field.type")}<select className="sc-tool-select" value={phase.field.type === "four-quadrant" ? "four-quadrant" : phase.field.type === "two-quadrant" ? `two-quadrant-${phase.field.axis}` : "three-candidate-zones"} onChange={(event) => onQuestionLayoutChange(event.target.value as "four-quadrant" | "two-quadrant-x" | "two-quadrant-y" | "three-candidate-zones", event.currentTarget)}><option value="four-quadrant">Four quadrants · X + Y axes</option><option value="two-quadrant-x">Two quadrants · left / right</option><option value="two-quadrant-y">Two quadrants · top / bottom</option><option value="three-candidate-zones">Three candidate zones</option></select></label>
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
        return <fieldset><legend>Candidate zones <small>field.zones</small></legend>
          <p className="sc-tool-copy field-hint">Zone IDs stay stable because they are also graph output handles. Labels and normalized polygon points are editable.</p>
          {field.zones.map((zone, zoneIndex) => <fieldset key={zone.id}><legend>{zone.id}</legend>
            {text("Candidate label", `field.zones.${zoneIndex}.label`, zone.label, (value) => {
              const zones = field.zones.map((item, index) => index === zoneIndex ? { ...item, label: value } : item);
              onChange({ ...phase, field: { ...field, zones } } as Phase);
            })}
            {zone.points.map((point, pointIndex) => <div className="polygon-point-fields" key={`${zone.id}-${pointIndex}`}>
              {number(`Point ${pointIndex + 1} X`, `points.${pointIndex}.x`, point.x, (x) => {
                const points = zone.points.map((item, index) => index === pointIndex ? { ...item, x: Math.min(1, x) } : item);
                const zones = field.zones.map((item, index) => index === zoneIndex ? { ...item, points } : item);
                onChange({ ...phase, field: { ...field, zones } } as Phase);
              })}
              {number(`Point ${pointIndex + 1} Y`, `points.${pointIndex}.y`, point.y, (y) => {
                const points = zone.points.map((item, index) => index === pointIndex ? { ...item, y: Math.min(1, y) } : item);
                const zones = field.zones.map((item, index) => index === zoneIndex ? { ...item, points } : item);
                onChange({ ...phase, field: { ...field, zones } } as Phase);
              })}
            </div>)}
          </fieldset>)}
        </fieldset>;
      })()}
      {phase.kind === "position-question" && <>
        {number("Question duration (ms)", "durationMs", phase.durationMs, (durationMs) => onChange({ ...phase, durationMs }))}
        {number("Outcome freeze (ms)", "freezeMs", phase.freezeMs, (freezeMs) => onChange({ ...phase, freezeMs }))}
      </>}
      {phase.kind === "video-position-question" && (() => {
        const timelineOriginMs = phase.audioSrc === undefined ? 0 : audioDurationMs ?? 0;
        const timelineMinMs = -timelineOriginMs;
        const timelineMaxMs = phase.audioSrc === undefined ? phase.expectedDurationMs : phase.tailDurationMs ?? 0;
        const changeOffset = (field: "showAtMs" | "openAtMs" | "closeAtMs" | "hideAtMs", value: number) => onChange({ ...phase, [field]: timelineOriginMs + value });
        return <fieldset className="timeline-fields"><legend>Vote timeline <small>{phase.audioSrc === undefined ? "milliseconds from media start" : "milliseconds from MP3 end"}</small></legend>
          {boundedNumber("Show question", "showAtMs", phase.showAtMs - timelineOriginMs, timelineMinMs, timelineMaxMs, (value) => changeOffset("showAtMs", value))}
          {boundedNumber("Open voting", "openAtMs", phase.openAtMs - timelineOriginMs, timelineMinMs, timelineMaxMs, (value) => changeOffset("openAtMs", value))}
          {boundedNumber("Close voting", "closeAtMs", phase.closeAtMs - timelineOriginMs, timelineMinMs, timelineMaxMs, (value) => changeOffset("closeAtMs", value))}
          {boundedNumber("Hide question", "hideAtMs", phase.hideAtMs - timelineOriginMs, timelineMinMs, timelineMaxMs, (value) => changeOffset("hideAtMs", value))}
          {phase.audioSrc !== undefined && <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={(phase.tailDurationMs ?? 0) < 1} onClick={() => {
            const tailDurationMs = phase.tailDurationMs ?? 0;
            onChange({ ...phase, showAtMs: timelineOriginMs, openAtMs: timelineOriginMs, closeAtMs: timelineOriginMs + Math.max(1, Math.floor(tailDurationMs * .8)), hideAtMs: timelineOriginMs + tailDurationMs });
          }}>Fit vote to audio tail</button>}
          <p className="sc-tool-copy field-hint">{phase.audioSrc === undefined
            ? `Required order: show ≤ open < close ≤ hide ≤ media duration (${phase.expectedDurationMs} ms).`
            : `0 ms is the end of the MP3. The tail runs from 0 to ${phase.tailDurationMs ?? 0} ms; negative values happen during the audio. Required order: show ≤ open < close ≤ hide.`}</p>
        </fieldset>;
      })()}
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
  }} />{status}</label>)}<label className="sc-tool-checkbox check"><input type="checkbox" checked={next.tieBreak?.type === "kleroterion"} onChange={(event) => onChange({ ...phase, next: { ...next, tieBreak: event.target.checked ? { type: "kleroterion" } : undefined } } as Phase)} />Resolve exact ties with Kleroterion</label></fieldset>;
}

function Compiled({ project }: { project: StudioProject }) {
  return <details><summary>Compiled scenario JSON (read only)</summary><pre>{compiledJson(project)}</pre></details>;
}
