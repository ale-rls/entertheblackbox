import { useEffect, useState, type CSSProperties } from "react";
import { formatTimelineTime } from "./timing.js";

export type TimelineMarker = {
  id: string;
  label: string;
  runtime: string;
  value: number;
  min?: number;
  max?: number;
  tone?: "show" | "open" | "close" | "end";
  shiftWith?: string[];
  onChange: (value: number) => void;
};

type Props = {
  label: string;
  min: number;
  max: number;
  markers: TimelineMarker[];
  origin?: number;
  step?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const percent = (value: number, min: number, max: number) => max === min ? 0 : ((value - min) / (max - min)) * 100;

export function TimingTimeline({ label, min, max, markers, origin, step = 100 }: Props) {
  const [draftValues, setDraftValues] = useState<Record<string, number>>(() => Object.fromEntries(markers.map((marker) => [marker.id, marker.value])));
  const markerValues = markers.map((marker) => `${marker.id}:${marker.value}`).join("|");
  useEffect(() => {
    setDraftValues(Object.fromEntries(markers.map((marker) => [marker.id, marker.value])));
  }, [markerValues]);

  const preview = (marker: TimelineMarker, next: number) => setDraftValues((values) => {
    const previous = values[marker.id] ?? marker.value;
    const updated = { ...values, [marker.id]: next };
    for (const linkedId of marker.shiftWith ?? []) {
      const linked = markers.find((candidate) => candidate.id === linkedId);
      if (!linked) continue;
      updated[linkedId] = clamp((values[linkedId] ?? linked.value) + next - previous, linked.min ?? min, linked.max ?? max);
    }
    return updated;
  });

  const commit = (marker: TimelineMarker, rawValue: string) => {
    const markerMin = marker.min ?? min;
    const markerMax = marker.max ?? max;
    const parsed = Number(rawValue);
    const next = clamp(Number.isFinite(parsed) ? parsed : marker.value, markerMin, markerMax);
    setDraftValues((values) => ({ ...values, [marker.id]: next }));
    marker.onChange(next);
  };
  const hasOrigin = origin !== undefined && origin > min && origin < max;

  return <div className="timing-timeline" aria-label={`${label} timeline`}>
    <div className="timing-ruler" aria-hidden="true">
      <div className="timing-ruler-track" />
      {hasOrigin && <span className="timing-origin" style={{ "--timeline-left": `${percent(origin, min, max)}%` } as CSSProperties} />}
      {markers.map((marker) => <span
        className="timing-ruler-marker"
        data-tone={marker.tone ?? "show"}
        key={marker.id}
        style={{ "--timeline-left": `${percent(draftValues[marker.id] ?? marker.value, min, max)}%` } as CSSProperties}
        title={`${marker.label}: ${formatTimelineTime(draftValues[marker.id] ?? marker.value)}`}
      />)}
      <span className="timing-ruler-label timing-ruler-start">{formatTimelineTime(min)}</span>
      {hasOrigin && <span className="timing-ruler-label timing-ruler-origin" style={{ "--timeline-left": `${percent(origin, min, max)}%` } as CSSProperties}>0</span>}
      <span className="timing-ruler-label timing-ruler-end">{formatTimelineTime(max)}</span>
    </div>
    <div className="timing-marker-rows">
      {markers.map((marker) => {
        const markerMin = marker.min ?? min;
        const markerMax = marker.max ?? max;
        const value = clamp(draftValues[marker.id] ?? marker.value, markerMin, markerMax);
        return <div className="timing-marker-row" data-tone={marker.tone ?? "show"} key={marker.id}>
          <label className="sc-tool-label timing-marker-value">
            <span>{marker.label}<small>{marker.runtime}</small></span>
            <input className="sc-tool-field" type="number" min={markerMin} max={markerMax} value={value} onChange={(event) => commit(marker, event.target.value)} />
          </label>
          <input
            className="timing-marker-slider"
            type="range"
            aria-label={`${marker.label} timeline slider`}
            min={markerMin}
            max={markerMax}
            step={step}
            value={value}
            onInput={(event) => {
              const next = Number(event.currentTarget.value);
              preview(marker, next);
            }}
            onPointerUp={(event) => commit(marker, event.currentTarget.value)}
            onKeyUp={(event) => commit(marker, event.currentTarget.value)}
            onBlur={(event) => {
              if ((draftValues[marker.id] ?? marker.value) !== marker.value) commit(marker, event.currentTarget.value);
            }}
          />
          <output>{formatTimelineTime(value)}</output>
        </div>;
      })}
    </div>
  </div>;
}
