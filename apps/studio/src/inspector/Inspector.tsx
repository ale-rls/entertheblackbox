import { useEffect, useState } from "react";
import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { compiledJson, componentTypeForPhase, phaseIdError, type AuthorableComponentType, type Phase } from "./model.js";
import { PolygonEditor, type PolygonEditorMedia } from "./PolygonEditor.js";
import { ArenaEllipseEditor, PLATE_A_ARENA_PRESET } from "./ArenaEllipseEditor.js";
import { ArenaQuadEditor, DEFAULT_ARENA_QUAD } from "./ArenaQuadEditor.js";
import { TimingTimeline } from "./TimingTimeline.js";
import { studioMediaKindForSource, type StudioMediaKind } from "../media/library.js";

type Props = {
  project: StudioProject;
  selectedId: string | undefined;
  localMedia: Array<{ src: string; durationMs?: number; previewUrl?: string }>;
  onRename: (nextId: string) => void;
  onChange: (phase: Phase) => void;
  onChooseMedia: (phaseId: string, target: "src" | "audioSrc", mediaKind: Exclude<StudioMediaKind, "unknown">, trigger: HTMLButtonElement) => void;
  onComponentTypeChange: (type: AuthorableComponentType, trigger: HTMLSelectElement) => void;
  onTransitionChange: (kind: "fixed" | "quadrant-plurality", trigger: HTMLSelectElement) => void;
  onQuestionLayoutChange: (layout: "four-quadrant" | "two-quadrant-x" | "two-quadrant-y" | "three-candidate-zones", trigger: HTMLSelectElement) => void;
  onTargetAudienceSizeChange: (value: number) => void;
};

const numberValue = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export function Inspector({ project, selectedId, localMedia, onRename, onChange, onChooseMedia, onComponentTypeChange, onTransitionChange, onQuestionLayoutChange, onTargetAudienceSizeChange }: Props) {
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
  const fieldMedia: PolygonEditorMedia | undefined = phase?.kind === "video-position-question"
    ? {
        kind: phase.audioSrc === undefined ? "video" : "image",
        src: localMedia.find((file) => file.src === phase.src)?.previewUrl
          ?? `/media/${phase.src.split("/").map(encodeURIComponent).join("/")}`,
        ...(phase.audioSrc === undefined ? { frameAtMs: phase.showAtMs } : {}),
      }
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
    {phase.kind !== "idle" && <label className="sc-tool-label">{label("Component type", "kind + media")}<select className="sc-tool-select" value={componentTypeForPhase(phase)} onChange={(event) => onComponentTypeChange(event.target.value as AuthorableComponentType, event.currentTarget)}>
      <option value="video">Video</option>
      <option value="image-audio">Still image + MP3</option>
      <option value="position-question">Position question</option>
      <option value="video-position-question">Video + position vote</option>
      <option value="image-audio-position-question">Still image + MP3 + position vote</option>
    </select></label>}
    {phase.kind !== "idle" && <label className="sc-tool-checkbox check"><input type="checkbox" checked={phase.showCursors ?? true} onChange={(event) => onChange({ ...phase, showCursors: event.target.checked })} />{label("Show cursors", "showCursors")}</label>}
    {(phase.kind === "video" || phase.kind === "video-position-question") && <>
      {text("Title (optional)", "title", phase.title ?? "", (value) => onChange({ ...phase, title: value.trim() ? value : undefined }))}
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
      />{label("Applause + boo crowd sounds", "rating")}</label>
      {phase.rating && text("Reaction subject", "rating.candidateLabel", phase.rating.candidateLabel, (candidateLabel) => onChange({
        ...phase,
        rating: { candidateLabel },
      }))}
      {phase.kind === "video-position-question" && phase.rating && <p className="sc-tool-copy field-hint">The phone keeps the regular spectrum trackpad active and shows applause/boo as secondary buttons. Reactions play varied crowd samples on the display; no score is shown.</p>}
    </>}
    {(phase.kind === "position-question" || phase.kind === "video-position-question") && <>
      {phase.kind === "position-question" && text("Title (optional)", "title", phase.title ?? "", (value) => onChange({ ...phase, title: value.trim() ? value : undefined }))}
      {text("Question", "text", phase.text, (value) => onChange({ ...phase, text: value }))}
      <label className="sc-tool-label">{label("Position layout", "field.type")}<select className="sc-tool-select" value={phase.field.type === "four-quadrant" ? "four-quadrant" : phase.field.type === "two-quadrant" ? `two-quadrant-${phase.field.axis}` : "three-candidate-zones"} onChange={(event) => onQuestionLayoutChange(event.target.value as "four-quadrant" | "two-quadrant-x" | "two-quadrant-y" | "three-candidate-zones", event.currentTarget)}><option value="four-quadrant">Four quadrants · X + Y axes</option><option value="two-quadrant-x">Two quadrants · left / right</option><option value="two-quadrant-y">Two quadrants · top / bottom</option><option value="three-candidate-zones">Polygon zones · custom</option></select></label>
      {phase.field.type === "four-quadrant" ? (() => {
        const field = phase.field;
        return <>
          {text("X axis · left endpoint", "field.xAxis.minLabel", field.xAxis.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, xAxis: { ...field.xAxis, minLabel } } } as Phase))}
          {text("X axis · right endpoint", "field.xAxis.maxLabel", field.xAxis.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, xAxis: { ...field.xAxis, maxLabel } } } as Phase))}
          {text("Y axis · top endpoint", "field.yAxis.minLabel", field.yAxis.minLabel, (minLabel) => onChange({ ...phase, field: { ...field, yAxis: { ...field.yAxis, minLabel } } } as Phase))}
          {text("Y axis · bottom endpoint", "field.yAxis.maxLabel", field.yAxis.maxLabel, (maxLabel) => onChange({ ...phase, field: { ...field, yAxis: { ...field.yAxis, maxLabel } } } as Phase))}
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
          <p className="sc-tool-copy field-hint">Select a zone, drag its corners, or redraw it by clicking around the arena. Zone IDs stay stable because they are also graph output handles.</p>
          <PolygonEditor zones={field.zones} {...(fieldMedia ? { media: fieldMedia } : {})} onChange={(zones) => {
            const currentNext = phase.next;
            const currentMap = currentNext.type === "quadrant-plurality" ? currentNext.map as Record<string, string> : undefined;
            const next = currentMap
              ? { ...currentNext, map: Object.fromEntries(zones.map((zone) => [zone.id, currentMap[zone.id] ?? "idle"])) }
              : currentNext;
            onChange({ ...phase, field: { ...field, zones }, next } as Phase);
          }} />
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
      {phase.field.type !== "polygon-zones" && (() => {
        const field = phase.field;
        return <fieldset><legend>Arena surface <small>field.arena</small></legend>
          <label className="sc-tool-checkbox check"><input type="checkbox" checked={field.arena !== undefined} onChange={(event) => {
            if (event.target.checked) {
              onChange({ ...phase, field: { ...field, arena: { ...PLATE_A_ARENA_PRESET } } } as Phase);
              return;
            }
            const { arena: _arena, ...withoutArena } = field;
            onChange({ ...phase, field: withoutArena } as Phase);
          }} />Constrain voting to a calibrated arena</label>
          {field.arena !== undefined && <label className="sc-tool-label">{label("Arena shape", "field.arena.type")}<select className="sc-tool-select" value={field.arena.type} onChange={(event) => {
            const nextArena = event.target.value === "quad" ? { ...DEFAULT_ARENA_QUAD } : { ...PLATE_A_ARENA_PRESET };
            onChange({ ...phase, field: { ...field, arena: nextArena } } as Phase);
          }}><option value="ellipse">Ellipse · center + radius</option><option value="quad">Perspective quad · 4 corners</option></select></label>}
          <p className="sc-tool-copy field-hint">{field.arena === undefined || field.arena.type === "ellipse"
            ? "Positions outside the oval do not count. The split lines pass through the oval’s calibrated center."
            : "Positions outside the quad do not count. The split lines connect the midpoints of opposite edges, so they follow the quad's perspective skew instead of a straight center line."}</p>
          {field.arena !== undefined && (field.arena.type === "quad"
            ? <ArenaQuadEditor
                arena={field.arena}
                field={field}
                {...(fieldMedia ? { media: fieldMedia } : {})}
                onChange={(arena) => onChange({ ...phase, field: { ...field, arena } } as Phase)}
              />
            : <ArenaEllipseEditor
                arena={field.arena}
                field={field}
                {...(fieldMedia ? { media: fieldMedia } : {})}
                onChange={(arena) => onChange({ ...phase, field: { ...field, arena } } as Phase)}
              />)}
        </fieldset>;
      })()}
      {phase.kind === "position-question" && (() => {
        const phaseEndMs = phase.durationMs + phase.freezeMs;
        const timelineMaxMs = Math.max(120_000, Math.ceil((phaseEndMs * 1.25) / 30_000) * 30_000);
        return <fieldset className="timeline-fields"><legend>Question timeline <small>milliseconds from question start</small></legend>
          <TimingTimeline label="Question" min={0} max={timelineMaxMs} markers={[
            { id: "duration", label: "Vote closes", runtime: "durationMs", value: phase.durationMs, min: 1, max: timelineMaxMs, tone: "close", shiftWith: ["freeze"], onChange: (durationMs) => onChange({ ...phase, durationMs }) },
            { id: "freeze", label: "Outcome ends", runtime: "durationMs + freezeMs", value: phaseEndMs, min: phase.durationMs, max: timelineMaxMs, tone: "end", onChange: (endMs) => onChange({ ...phase, freezeMs: Math.max(0, endMs - phase.durationMs) }) },
          ]} />
          <p className="sc-tool-copy field-hint">Voting closes at {phase.durationMs} ms. The resolved outcome then stays visible for {phase.freezeMs} ms.</p>
        </fieldset>;
      })()}
      {phase.kind === "video-position-question" && (() => {
        const timelineOriginMs = phase.audioSrc === undefined ? 0 : audioDurationMs ?? 0;
        const timelineMinMs = -timelineOriginMs;
        const timelineMaxMs = phase.audioSrc === undefined ? phase.expectedDurationMs : phase.tailDurationMs ?? 0;
        const changeOffset = (field: "showAtMs" | "openAtMs" | "closeAtMs" | "hideAtMs", value: number) => onChange({ ...phase, [field]: timelineOriginMs + value });
        const showOffset = phase.showAtMs - timelineOriginMs;
        const openOffset = phase.openAtMs - timelineOriginMs;
        const closeOffset = phase.closeAtMs - timelineOriginMs;
        const hideOffset = phase.hideAtMs - timelineOriginMs;
        return <fieldset className="timeline-fields"><legend>Vote timeline <small>{phase.audioSrc === undefined ? "milliseconds from media start" : "milliseconds from MP3 end"}</small></legend>
          <TimingTimeline label="Vote" min={timelineMinMs} max={timelineMaxMs} origin={0} markers={[
            { id: "show", label: "Show question", runtime: "showAtMs", value: showOffset, min: timelineMinMs, max: openOffset, tone: "show", onChange: (value) => changeOffset("showAtMs", value) },
            { id: "open", label: "Open voting", runtime: "openAtMs", value: openOffset, min: showOffset, max: Math.max(showOffset, closeOffset - 1), tone: "open", onChange: (value) => changeOffset("openAtMs", value) },
            { id: "close", label: "Close voting", runtime: "closeAtMs", value: closeOffset, min: openOffset + 1, max: hideOffset, tone: "close", onChange: (value) => changeOffset("closeAtMs", value) },
            { id: "hide", label: "Hide question", runtime: "hideAtMs", value: hideOffset, min: closeOffset, max: timelineMaxMs, tone: "end", onChange: (value) => changeOffset("hideAtMs", value) },
          ]} />
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
