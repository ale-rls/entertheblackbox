import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ArenaEllipse, Axis } from "../../../../packages/shared/src/index.js";
import type { PolygonEditorMedia } from "./PolygonEditor.js";

type DragHandle = "move" | "left" | "right" | "top" | "bottom";
type Point = { x: number; y: number };

/** Calibrated against the published 2048×1152 PLATE-A_master.png arena floor. */
export const PLATE_A_ARENA_PRESET: ArenaEllipse = {
  type: "ellipse",
  centerX: 0.5,
  centerY: 0.735,
  radiusX: 0.42,
  radiusY: 0.235,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Math.round(value * 10_000) / 10_000;

function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: rounded(rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width),
    y: rounded(rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height),
  };
}

function VideoBackdrop({ media }: { media: PolygonEditorMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seek = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(0, (media.frameAtMs ?? 0) / 1000), Math.max(0, video.duration - 0.05));
  };
  useEffect(() => {
    const video = videoRef.current;
    if (video?.readyState && video.readyState >= 1) seek();
  }, [media.frameAtMs, media.src]);
  return <video ref={videoRef} className="polygon-editor-media polygon-editor-media-video" src={media.src} muted playsInline preload="auto" onLoadedMetadata={seek} aria-hidden />;
}

export function ArenaEllipseEditor({
  arena,
  field,
  media,
  onChange,
}: {
  arena: ArenaEllipse;
  field: { type: "four-quadrant"; xAxis: Axis; yAxis: Axis } | { type: "two-quadrant"; axis: "x" | "y"; labels: Axis };
  media?: PolygonEditorMedia;
  onChange: (arena: ArenaEllipse) => void;
}) {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const dragging = useRef<{ handle: DragHandle; start: Point; arena: ArenaEllipse } | null>(null);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const beginDrag = (event: ReactPointerEvent<SVGElement>, handle: DragHandle) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const start = {
      x: rounded(rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width),
      y: rounded(rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height),
    };
    dragging.current = { handle, start, arena };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragging.current;
    if (drag === null) return;
    const point = pointFromEvent(event);
    const start = drag.arena;
    if (drag.handle === "move") {
      onChange({
        ...start,
        centerX: rounded(clamp(start.centerX + point.x - drag.start.x, start.radiusX, 1 - start.radiusX)),
        centerY: rounded(clamp(start.centerY + point.y - drag.start.y, start.radiusY, 1 - start.radiusY)),
      });
      return;
    }
    if (drag.handle === "left" || drag.handle === "right") {
      const fixed = drag.handle === "left" ? start.centerX + start.radiusX : start.centerX - start.radiusX;
      const moving = drag.handle === "left"
        ? clamp(point.x, 0, fixed - 0.02)
        : clamp(point.x, fixed + 0.02, 1);
      onChange({ ...start, centerX: rounded((fixed + moving) / 2), radiusX: rounded(Math.abs(fixed - moving) / 2) });
      return;
    }
    const fixed = drag.handle === "top" ? start.centerY + start.radiusY : start.centerY - start.radiusY;
    const moving = drag.handle === "top"
      ? clamp(point.y, 0, fixed - 0.02)
      : clamp(point.y, fixed + 0.02, 1);
    onChange({ ...start, centerY: rounded((fixed + moving) / 2), radiusY: rounded(Math.abs(fixed - moving) / 2) });
  };

  const updateNumber = (key: "centerX" | "centerY" | "radiusX" | "radiusY", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    if (key === "centerX") onChange({ ...arena, centerX: rounded(clamp(value, arena.radiusX, 1 - arena.radiusX)) });
    if (key === "centerY") onChange({ ...arena, centerY: rounded(clamp(value, arena.radiusY, 1 - arena.radiusY)) });
    if (key === "radiusX") onChange({ ...arena, radiusX: rounded(clamp(value, 0.01, Math.min(arena.centerX, 1 - arena.centerX))) });
    if (key === "radiusY") onChange({ ...arena, radiusY: rounded(clamp(value, 0.01, Math.min(arena.centerY, 1 - arena.centerY))) });
  };

  const cx = arena.centerX * 100;
  const cy = arena.centerY * 100;
  const rx = arena.radiusX * 100;
  const ry = arena.radiusY * 100;
  const drawHorizontal = field.type === "four-quadrant" || field.axis === "y";
  const drawVertical = field.type === "four-quadrant" || field.axis === "x";

  return <div className="arena-ellipse-editor">
    <div className="polygon-editor-viewport" data-media-kind={media?.kind} style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}>
      {media?.kind === "video" && <VideoBackdrop media={media} />}
      {media?.kind === "image" && <img className="polygon-editor-media polygon-editor-media-image" src={media.src} alt="" />}
      <svg
        className="polygon-editor-canvas arena-ellipse-canvas"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Arena ellipse editor"
        onPointerMove={handleMove}
        onPointerUp={() => { dragging.current = null; }}
        onPointerCancel={() => { dragging.current = null; }}
      >
        <ellipse className="arena-editor-fill" cx={cx} cy={cy} rx={rx} ry={ry} onPointerDown={(event) => beginDrag(event, "move")} />
        {drawHorizontal && <line className="arena-editor-divider" x1={cx - rx} y1={cy} x2={cx + rx} y2={cy} />}
        {drawVertical && <line className="arena-editor-divider" x1={cx} y1={cy - ry} x2={cx} y2={cy + ry} />}
        <ellipse className="arena-editor-outline" cx={cx} cy={cy} rx={rx} ry={ry} />
        <circle className="arena-editor-center" cx={cx} cy={cy} r="1.5" onPointerDown={(event) => beginDrag(event, "move")} />
        {(["left", "right", "top", "bottom"] as const).map((handle) => <circle
          key={handle}
          className="arena-editor-handle"
          data-arena-handle={handle}
          cx={handle === "left" ? cx - rx : handle === "right" ? cx + rx : cx}
          cy={handle === "top" ? cy - ry : handle === "bottom" ? cy + ry : cy}
          r="2.1"
          onPointerDown={(event) => beginDrag(event, handle)}
        />)}
      </svg>
      <span className="polygon-editor-viewport-label">Display viewport · {viewport.width}×{viewport.height}{media ? ` · ${media.kind === "image" ? "contain" : "cover"}` : ""}</span>
    </div>
    <div className="arena-ellipse-fields">
      {(["centerX", "centerY", "radiusX", "radiusY"] as const).map((key) => <label className="sc-tool-label" key={key}>
        <span>{key}<small>0–1</small></span>
        <input className="sc-tool-field" type="number" min={key.startsWith("radius") ? 0.01 : 0} max="1" step="0.001" value={arena[key]} onChange={(event) => updateNumber(key, event.target.value)} />
      </label>)}
    </div>
    <div className="polygon-editor-actions">
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => onChange({ ...PLATE_A_ARENA_PRESET })}>Fit PLATE-A arena</button>
      <span className="sc-tool-copy">Drag the oval to move it; drag its four handles to fit the arena edge. Numbers allow exact fine-tuning.</span>
    </div>
  </div>;
}
