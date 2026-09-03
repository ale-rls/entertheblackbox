import type { PositionField } from "@smartphonecracy/scenario";
import { arenaEllipseSplitY, arenaQuadLandmarks } from "@smartphonecracy/shared";

export type Point = { x: number; y: number };
export type Segment = { start: Point; end: Point };

/**
 * Returns the same normalized spectrum line that QuadrantOverlay renders.
 * Hard splits and non-spectrum fields deliberately have no glow segment.
 */
export function spectrumSegment(field: PositionField): Segment | null {
  if (field.type !== "two-quadrant" || field.variant === "split") return null;

  if (field.arena?.type === "quad") {
    const { topMid, rightMid, bottomMid, leftMid } = arenaQuadLandmarks(field.arena.corners);
    return field.axis === "x"
      ? { start: leftMid, end: rightMid }
      : { start: topMid, end: bottomMid };
  }

  if (field.arena?.type === "ellipse") {
    const { centerX, centerY, radiusX, radiusY } = field.arena;
    if (field.axis === "y") {
      return {
        start: { x: centerX, y: centerY - radiusY },
        end: { x: centerX, y: centerY + radiusY },
      };
    }

    const splitY = arenaEllipseSplitY(field.arena);
    const splitHalfWidth = radiusX * Math.sqrt(
      Math.max(0, 1 - ((splitY - centerY) / radiusY) ** 2),
    );
    return {
      start: { x: centerX - splitHalfWidth, y: splitY },
      end: { x: centerX + splitHalfWidth, y: splitY },
    };
  }

  return field.axis === "x"
    ? { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } }
    : { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } };
}

/** Projects a normalized cursor onto a normalized line in display-pixel space. */
export function projectOntoSegment(
  point: Point,
  segment: Segment,
  width: number,
  height: number,
): { point: Point; distance: number; position: number } {
  const px = point.x * width;
  const py = point.y * height;
  const ax = segment.start.x * width;
  const ay = segment.start.y * height;
  const bx = segment.end.x * width;
  const by = segment.end.y * height;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const position = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + dx * position;
  const y = ay + dy * position;

  return {
    point: { x, y },
    distance: Math.hypot(px - x, py - y),
    position,
  };
}

/** Gaussian falloff: nearby cursors contribute strongly, distant ones softly. */
export function proximityStrength(distance: number, influenceDistance: number): number {
  if (influenceDistance <= 0) return 0;
  const normalized = distance / influenceDistance;
  if (normalized >= 3) return 0;
  return Math.exp(-0.5 * normalized * normalized);
}

