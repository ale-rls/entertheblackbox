import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { arenaQuadLandmarks, type Arena, type ArenaQuad, type Axis } from "../../../../packages/shared/src/index.js";
import type { PolygonEditorMedia } from "./PolygonEditor.js";

type DragHandle = "move" | 0 | 1 | 2 | 3;
type Point = { x: number; y: number };

/**
 * Starting trapezoid for a freshly-enabled quad arena: narrower at the top
 * (far edge, near the horizon) and wider at the bottom (near edge, closer
 * to camera), roughly matching the same PLATE-A amphitheater floor the
 * ellipse preset targets. Authors drag the corners from here to match
 * their own footage.
 */
export const DEFAULT_ARENA_QUAD: ArenaQuad = {
  type: "quad",
  corners: [
    { x: 0.14, y: 0.52 },
    { x: 0.86, y: 0.52 },
    { x: 0.94, y: 0.97 },
    { x: 0.06, y: 0.97 },
  ],
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Math.round(value * 10_000) / 10_000;

function pointFromRect(rect: DOMRect, clientX: number, clientY: number): Point {
  return {
    x: rounded(rect.width === 0 ? 0 : (clientX - rect.left) / rect.width),
    y: rounded(rect.height === 0 ? 0 : (clientY - rect.top) / rect.height),
  };
}

/** For pointerdown on a handle/fill element: its owning root SVG defines the coordinate space. */
function pointFromChildEvent(event: ReactPointerEvent<SVGElement>): Point {
  const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
  return pointFromRect(rect, event.clientX, event.clientY);
}

/** For pointermove on the root SVG itself (drag tracking after pointer capture). */
function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): Point {
  return pointFromRect(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
}

function svgPoints(points: readonly Point[]): string {
  return points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
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

export function ArenaQuadEditor({
  arena,
  field,
  media,
  onChange,
}: {
  arena: ArenaQuad;
  field: { type: "four-quadrant"; xAxis: Axis; yAxis: Axis } | { type: "two-quadrant"; axis: "x" | "y"; variant: "split" | "spectrum"; labels: Axis };
  media?: PolygonEditorMedia;
  onChange: (arena: ArenaQuad) => void;
}) {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const dragging = useRef<{ handle: DragHandle; start: Point; arena: ArenaQuad } | null>(null);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const beginDrag = (event: ReactPointerEvent<SVGElement>, handle: DragHandle) => {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = { handle, start: pointFromChildEvent(event), arena };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragging.current;
    if (drag === null) return;
    const point = pointFromEvent(event);
    if (drag.handle === "move") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      // Clamp the translation so every corner stays on-screen, not just the one under the pointer.
      const minDx = Math.max(...drag.arena.corners.map((c) => -c.x));
      const maxDx = Math.min(...drag.arena.corners.map((c) => 1 - c.x));
      const minDy = Math.max(...drag.arena.corners.map((c) => -c.y));
      const maxDy = Math.min(...drag.arena.corners.map((c) => 1 - c.y));
      const clampedDx = clamp(dx, minDx, maxDx);
      const clampedDy = clamp(dy, minDy, maxDy);
      onChange({
        ...drag.arena,
        corners: drag.arena.corners.map((c) => ({ x: rounded(c.x + clampedDx), y: rounded(c.y + clampedDy) })) as ArenaQuad["corners"],
      });
      return;
    }
    const corners = drag.arena.corners.map((c, index) => index === drag.handle ? { x: rounded(clamp(point.x)), y: rounded(clamp(point.y)) } : c) as ArenaQuad["corners"];
    onChange({ ...drag.arena, corners });
  };

  const updateNumber = (cornerIndex: number, axis: "x" | "y", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const corners = arena.corners.map((c, index) => index === cornerIndex ? { ...c, [axis]: rounded(clamp(value)) } : c) as ArenaQuad["corners"];
    onChange({ ...arena, corners });
  };

  const { topMid, rightMid, bottomMid, leftMid } = arenaQuadLandmarks(arena.corners);
  const spectrum = field.type === "two-quadrant" && field.variant !== "split";
  const drawHorizontal = field.type === "four-quadrant" || (spectrum ? field.axis === "x" : field.axis === "y");
  const drawVertical = field.type === "four-quadrant" || (spectrum ? field.axis === "y" : field.axis === "x");
  const lineClass = field.type === "four-quadrant" || !spectrum ? "arena-editor-divider" : "arena-editor-axis";
  const cornerLabels = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

  return <div className="arena-quad-editor">
    <div className="polygon-editor-viewport" data-media-kind={media?.kind} style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}>
      {media?.kind === "video" && <VideoBackdrop media={media} />}
      {media?.kind === "image" && <img className="polygon-editor-media polygon-editor-media-image" src={media.src} alt="" />}
      <svg
        className="polygon-editor-canvas arena-quad-canvas"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Arena quad editor"
        onPointerMove={handleMove}
        onPointerUp={() => { dragging.current = null; }}
        onPointerCancel={() => { dragging.current = null; }}
      >
        <polygon className="arena-editor-fill" points={svgPoints(arena.corners)} onPointerDown={(event) => beginDrag(event, "move")} />
        {drawHorizontal && <line className={lineClass} x1={leftMid.x * 100} y1={leftMid.y * 100} x2={rightMid.x * 100} y2={rightMid.y * 100} />}
        {drawVertical && <line className={lineClass} x1={topMid.x * 100} y1={topMid.y * 100} x2={bottomMid.x * 100} y2={bottomMid.y * 100} />}
        <polygon className="arena-editor-outline" points={svgPoints(arena.corners)} />
        {arena.corners.map((corner, index) => <circle
          key={index}
          className="arena-editor-handle"
          data-arena-handle={cornerLabels[index]}
          aria-label={`${cornerLabels[index]} corner`}
          cx={corner.x * 100}
          cy={corner.y * 100}
          r="2.1"
          onPointerDown={(event) => beginDrag(event, index as 0 | 1 | 2 | 3)}
        />)}
      </svg>
      <span className="polygon-editor-viewport-label">Display viewport · {viewport.width}×{viewport.height}{media ? ` · ${media.kind === "image" ? "contain" : "cover"}` : ""}</span>
    </div>
    <div className="arena-quad-fields">
      {arena.corners.map((corner, index) => <div className="arena-quad-corner-fields" key={index}>
        <span className="sc-tool-copy arena-quad-corner-label">{cornerLabels[index]}</span>
        <label className="sc-tool-label"><span>x<small>0–1</small></span><input className="sc-tool-field" type="number" min="0" max="1" step="0.001" value={corner.x} onChange={(event) => updateNumber(index, "x", event.target.value)} /></label>
        <label className="sc-tool-label"><span>y<small>0–1</small></span><input className="sc-tool-field" type="number" min="0" max="1" step="0.001" value={corner.y} onChange={(event) => updateNumber(index, "y", event.target.value)} /></label>
      </div>)}
    </div>
    <div className="polygon-editor-actions">
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => onChange({ ...DEFAULT_ARENA_QUAD })}>Reset to default trapezoid</button>
      <span className="sc-tool-copy">Drag the quad to move it; drag its four corners to trace the arena's perspective. Spectrum lines connect the matching edge midpoints.</span>
    </div>
  </div>;
}

export function isArenaQuad(arena: Arena): arena is ArenaQuad {
  return arena.type === "quad";
}
