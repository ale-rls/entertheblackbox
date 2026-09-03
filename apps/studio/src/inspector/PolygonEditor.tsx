import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { REFERENCE_DISPLAY_HEIGHT, REFERENCE_DISPLAY_WIDTH } from "./referenceDisplay.js";

type PositionPhase = Extract<StudioProject["scenario"]["phases"][number], { kind: "position-question" | "video-position-question" }>;
type PolygonField = Extract<PositionPhase["field"], { type: "polygon-zones" }>;
type PolygonZone = PolygonField["zones"][number];
type PolygonPoint = PolygonZone["points"][number];

type Drawing = {
  zoneId: string;
  points: PolygonPoint[];
};

export type PolygonEditorMedia = {
  kind: "video" | "image";
  src: string;
  frameAtMs?: number;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const rounded = (value: number) => Math.round(clamp(value) * 10_000) / 10_000;
const svgPoints = (points: readonly PolygonPoint[]) => points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");

function newZone(zones: readonly PolygonZone[]): PolygonZone {
  const ids = new Set(zones.map((zone) => zone.id));
  let number = 1;
  while (ids.has(`candidate-${number}`)) number += 1;
  return {
    id: `candidate-${number}`,
    label: `Candidate ${number}`,
    points: [{ x: 0.375, y: 0.375 }, { x: 0.625, y: 0.375 }, { x: 0.625, y: 0.625 }, { x: 0.375, y: 0.625 }],
  };
}

function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): PolygonPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: rounded(rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width),
    y: rounded(rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height),
  };
}

function VideoBackdrop({ media }: { media: PolygonEditorMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekToQuestion = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(0, (media.frameAtMs ?? 0) / 1000), Math.max(0, video.duration - 0.05));
  };

  useEffect(() => {
    const video = videoRef.current;
    if (video?.readyState && video.readyState >= 1) seekToQuestion();
  }, [media.frameAtMs, media.src]);

  return <video ref={videoRef} className="polygon-editor-media polygon-editor-media-video" src={media.src} muted playsInline preload="auto" onLoadedMetadata={seekToQuestion} aria-hidden />;
}

export function PolygonEditor({ zones, media, onChange }: { zones: PolygonZone[]; media?: PolygonEditorMedia; onChange: (zones: PolygonZone[]) => void }) {
  const [selectedId, setSelectedId] = useState(zones[0]?.id ?? "");
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const draggingPoint = useRef<number | null>(null);
  const selected = zones.find((zone) => zone.id === selectedId) ?? zones[0];

  useEffect(() => {
    if (!zones.some((zone) => zone.id === selectedId)) setSelectedId(zones[0]?.id ?? "");
  }, [selectedId, zones]);

  const replaceSelectedPoints = (points: PolygonPoint[]) => {
    if (!selected) return;
    onChange(zones.map((zone) => zone.id === selected.id ? { ...zone, points } : zone));
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing === null) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    setDrawing((current) => current === null ? null : { ...current, points: [...current.points, point] });
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing !== null || draggingPoint.current === null || !selected) return;
    const point = pointFromEvent(event);
    replaceSelectedPoints(selected.points.map((item, index) => index === draggingPoint.current ? point : item));
  };

  if (!selected) return null;

  return <div className="polygon-editor">
    <div className="polygon-editor-zones" role="list" aria-label="Polygon zones">
      {zones.map((zone) => <button
        className="sc-tool-button polygon-zone-select"
        data-sc-tool-variant={zone.id === selected.id ? "primary" : "secondary"}
        type="button"
        key={zone.id}
        onClick={() => { setSelectedId(zone.id); setDrawing(null); }}
      >{zone.label}</button>)}
    </div>
    <div className="polygon-editor-zone-management">
      <span className="sc-tool-copy">{zones.length} zone{zones.length === 1 ? "" : "s"}</span>
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => {
        const zone = newZone(zones);
        setSelectedId(zone.id);
        setDrawing(null);
        onChange([...zones, zone]);
      }}>Add zone</button>
      <button className="sc-tool-button" data-sc-tool-variant="danger" type="button" disabled={zones.length === 1} aria-label={`Remove selected zone ${selected.label}`} onClick={() => {
        const selectedIndex = zones.findIndex((zone) => zone.id === selected.id);
        const nextZones = zones.filter((zone) => zone.id !== selected.id);
        setSelectedId(nextZones[Math.min(selectedIndex, nextZones.length - 1)]?.id ?? "");
        setDrawing(null);
        onChange(nextZones);
      }}>Remove zone</button>
    </div>
    <div className="polygon-editor-viewport" data-media-kind={media?.kind} style={{ aspectRatio: `${REFERENCE_DISPLAY_WIDTH} / ${REFERENCE_DISPLAY_HEIGHT}` }}>
      {media?.kind === "video" && <VideoBackdrop media={media} />}
      {media?.kind === "image" && <img className="polygon-editor-media polygon-editor-media-image" src={media.src} alt="" />}
      <svg
        className={`polygon-editor-canvas${drawing === null ? "" : " is-drawing"}`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Polygon editor. Selected zone: ${selected.label}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={() => { draggingPoint.current = null; }}
        onPointerCancel={() => { draggingPoint.current = null; }}
      >
        <path className="polygon-editor-grid" d="M50 0V100M0 50H100" />
        {zones.map((zone) => <polygon
          className={`polygon-editor-zone${zone.id === selected.id ? " is-selected" : ""}`}
          data-zone-id={zone.id}
          key={zone.id}
          points={svgPoints(zone.points)}
          onClick={() => { if (drawing === null) setSelectedId(zone.id); }}
        />)}
        {drawing === null
          ? selected.points.map((point, index) => <circle
              className="polygon-editor-handle"
              aria-label={`${selected.label} point ${index + 1}`}
              key={`${selected.id}-${index}`}
              cx={point.x * 100}
              cy={point.y * 100}
              r="2.4"
              onPointerDown={(event) => {
                event.stopPropagation();
                draggingPoint.current = index;
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
            />)
          : <>
              {drawing.points.length >= 3
                ? <polygon className="polygon-editor-draft" points={svgPoints(drawing.points)} />
                : <polyline className="polygon-editor-draft" points={svgPoints(drawing.points)} />}
              {drawing.points.map((point, index) => <circle className="polygon-editor-draft-point" key={index} cx={point.x * 100} cy={point.y * 100} r="2.1" />)}
            </>}
      </svg>
      <span className="polygon-editor-viewport-label">Display viewport · {REFERENCE_DISPLAY_WIDTH}×{REFERENCE_DISPLAY_HEIGHT}{media ? " · cover" : ""}</span>
    </div>
    {drawing === null
      ? <div className="polygon-editor-actions">
          <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => setDrawing({ zoneId: selected.id, points: [] })}>Redraw selected zone</button>
          <span className="sc-tool-copy">Drag a point to reshape.</span>
        </div>
      : <div className="polygon-editor-actions">
          <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={drawing.points.length === 0} onClick={() => setDrawing((current) => current === null ? null : { ...current, points: current.points.slice(0, -1) })}>Undo point</button>
          <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => setDrawing(null)}>Cancel redraw</button>
          <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={drawing.points.length < 3} onClick={() => {
            replaceSelectedPoints(drawing.points);
            setDrawing(null);
          }}>Save polygon</button>
          <span className="sc-tool-copy">Click at least three corners in order. {drawing.points.length} placed.</span>
        </div>}
  </div>;
}
