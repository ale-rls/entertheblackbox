import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);
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
  const valueAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = min + clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * (max - min);
    return Math.round(raw / step) * step;
  };
  const markerAtPointer = (value: number) => markers.reduce((nearest, marker) =>
    Math.abs((draftValues[marker.id] ?? marker.value) - value) < Math.abs((draftValues[nearest.id] ?? nearest.value) - value) ? marker : nearest,
  markers[0]!);
  const moveRulerMarker = (event: ReactPointerEvent<HTMLDivElement>, final: boolean) => {
    if (markers.length === 0) return;
    const raw = valueAtPointer(event);
    const marker = markers.find((candidate) => candidate.id === draggingMarkerId) ?? markerAtPointer(raw);
    const next = clamp(raw, marker.min ?? min, marker.max ?? max);
    preview(marker, next);
    if (final) commit(marker, String(next));
  };

  return <div className="timing-timeline" aria-label={`${label} timeline`}>
    <div
      className="timing-ruler"
      role="group"
      aria-label={`${label} interactive timeline ruler`}
      onPointerDown={(event) => {
        const marker = markerAtPointer(valueAtPointer(event));
        setDraggingMarkerId(marker.id);
        event.currentTarget.setPointerCapture(event.pointerId);
        moveRulerMarker(event, false);
      }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveRulerMarker(event, false); }}
      onPointerUp={(event) => {
        moveRulerMarker(event, true);
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDraggingMarkerId(null);
      }}
      onPointerCancel={() => setDraggingMarkerId(null)}
    >
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
