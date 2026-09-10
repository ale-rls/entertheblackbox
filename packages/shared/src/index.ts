/**
 * Shared constants for the smartphonecracy installation.
 * Values mirror the locked defaults in the implementation plan (§5).
 * Director-configurable values live in InstallationPolicy at runtime;
 * these are the v1 defaults.
 */

export const DEFAULT_INSTALLATION_POLICY = {
  maxParticipants: 30,
  qrRotationMs: 60_000,
  joinGrantTtlMs: 120_000,
  participantLeaseTtlMs: 7_200_000,
  allowLateJoin: true,
  activeQrVisibility: "corner",
  lobbyCountdownMs: 10_000,
  minParticipants: 1,
  interactiveIdleTimeoutMs: 180_000,
  maxSessionDurationMs: 1_800_000,
} as const;

/** v1 media manifest ceiling in bytes (plan §5). */
export const MEDIA_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

/** Server-side fallback slack after a video's expected duration (plan §9). */
export const VIDEO_END_TIMEOUT_SLACK_MS = 5_000;

export type Axis = {
  minLabel: string;
  maxLabel: string;
};

/**
 * Optional calibrated footprint for a physical voting surface in the display
 * image. Coordinates are normalized to the full display viewport so the same
 * geometry can be used for rendering and server-side vote classification.
 */
export type ArenaEllipse = {
  type: "ellipse";
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  /**
   * Viewport Y coordinate of the physical front/back split. Perspective can
   * project the arena's true centre above the ellipse's geometric centre.
   * Older scenarios omit this and receive the default perspective offset.
   */
  splitY?: number | undefined;
};

/**
 * Physical front/back split. A projected circle's physical centre appears
 * above the bounding ellipse's geometric centre, so v1 ellipse data receives
 * the same subtle perspective lift as the PLATE-A preset.
 */
export function arenaEllipseSplitY(arena: ArenaEllipse): number {
  return arena.splitY ?? arena.centerY - arena.radiusY * 0.28;
}

/**
 * Perspective-calibrated alternative to ArenaEllipse: the four corners of
 * the voting surface as they actually appear in the shot (e.g. a circular
 * amphitheater floor filmed at an angle projects to a trapezoid, not a
 * centered ellipse). Corners are normalized (0..1) to the full display
 * viewport, given in on-screen order starting top-left.
 */
export type ArenaQuad = {
  type: "quad";
  corners: [PolygonPoint, PolygonPoint, PolygonPoint, PolygonPoint];
};

export type Arena = ArenaEllipse | ArenaQuad;

export const FOUR_QUADRANTS = ["q1", "q2", "q3", "q4"] as const;
export const TWO_QUADRANTS = ["min", "max"] as const;

/** Compatibility name for the original four-quadrant-only API. */
export const QUADRANTS = FOUR_QUADRANTS;

/** Stable, auditable selection used for Kleroterion tie draws and Studio preview parity. */
export function deterministicChoice<T extends string>(seed: string, choices: readonly T[]): T {
  if (choices.length === 0) throw new Error("deterministicChoice requires at least one choice");
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return choices[hash % choices.length]!;
}

export type FourQuadrant = (typeof FOUR_QUADRANTS)[number];
export type TwoQuadrant = (typeof TWO_QUADRANTS)[number];
/** Compatibility type for the original four-quadrant-only API. */
export type Quadrant = FourQuadrant;

export type FourQuadrantField = {
  type: "four-quadrant";
  xAxis: Axis;
  yAxis: Axis;
  arena?: Arena | undefined;
};

export type TwoQuadrantField = {
  type: "two-quadrant";
  axis: "x" | "y";
  variant: "split" | "spectrum";
  labels: Axis;
  /** Viewport X coordinate of the left/right boundary when no arena is configured. */
  splitX?: number | undefined;
  arena?: Arena | undefined;
};

export type PolygonPoint = { x: number; y: number };

export type PolygonZone = {
  id: string;
  label: string;
  /** Normalized (0..1) polygon vertices, at least 3. */
  points: PolygonPoint[];
};

export type PolygonZonesField = {
  type: "polygon-zones";
  zones: PolygonZone[];
};

export type PositionField = FourQuadrantField | TwoQuadrantField | PolygonZonesField;

export type PositionQuadrant<Field extends PositionField = PositionField> =
  Field extends FourQuadrantField
    ? FourQuadrant
    : Field extends TwoQuadrantField
      ? TwoQuadrant
      : string;

export type PositionQuadrantCounts<Field extends PositionField = PositionField> =
  Field extends FourQuadrantField
    ? Record<FourQuadrant, number>
    : Field extends TwoQuadrantField
      ? Record<TwoQuadrant, number>
      : Record<string, number>;

/**
 * Quadrant assignment for a normalized position (0..1, y grows downward).
 * Half-open boundary convention (plan §5): x = 0.5 belongs to the right
 * half, y = 0.5 belongs to the bottom half, so the exact center is q4.
 */
export function quadrantOf(x: number, y: number): Quadrant {
  const right = x >= 0.5;
  const bottom = y >= 0.5;
  if (right) return bottom ? "q4" : "q1";
  return bottom ? "q3" : "q2";
}

/**
 * Point-in-polygon test (ray casting) for a normalized (0..1) point against
 * a polygon's vertices. Points exactly on an edge may resolve either way;
 * zones are expected to be drawn with a visible gap between them so this
 * doesn't matter in practice.
 */
function pointInPolygon(points: readonly PolygonPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    const crosses = a.y > y !== b.y > y;
    if (crosses && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Average of a polygon's vertices -- used to anchor labels/counts at a region's centroid. */
export function centroid(points: readonly PolygonPoint[]): PolygonPoint {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function midpoint(a: PolygonPoint, b: PolygonPoint): PolygonPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Sign of the cross product of (b-a) and (p-a): tells which side of the
 * line through a→b the point p falls on. Which sign means "which physical
 * direction" depends on a→b's own orientation, so callers compare against
 * a concrete threshold derived from a known point (see quadrantOfField)
 * rather than treating the sign as universally "left"/"right".
 */
function sideOfLine(a: PolygonPoint, b: PolygonPoint, p: PolygonPoint): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/**
 * The five landmark points of a calibrated arena quad: each edge's
 * midpoint plus the overall center (average of the four corners). A
 * bilinear parameterization of the quad (u along top-left→top-right,
 * v along top-left→bottom-left) has straight iso-lines, so the line
 * through two opposite edge midpoints is exactly the quad's u=0.5 or
 * v=0.5 split -- no further perspective math is needed to divide the
 * calibrated shape correctly.
 */
export function arenaQuadLandmarks(corners: ArenaQuad["corners"]): {
  topMid: PolygonPoint;
  rightMid: PolygonPoint;
  bottomMid: PolygonPoint;
  leftMid: PolygonPoint;
  center: PolygonPoint;
} {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  return {
    topMid: midpoint(topLeft, topRight),
    rightMid: midpoint(topRight, bottomRight),
    bottomMid: midpoint(bottomRight, bottomLeft),
    leftMid: midpoint(bottomLeft, topLeft),
    center: centroid(corners),
  };
}

/** Sub-quad polygons for a four-quadrant split of a calibrated arena quad, keyed like FOUR_QUADRANT_POSITIONS. */
export function arenaQuadFourRegions(corners: ArenaQuad["corners"]): Record<FourQuadrant, PolygonPoint[]> {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const { topMid, rightMid, bottomMid, leftMid, center } = arenaQuadLandmarks(corners);
  return {
    q1: [topMid, topRight, rightMid, center],
    q2: [topLeft, topMid, center, leftMid],
    q3: [leftMid, center, bottomMid, bottomLeft],
    q4: [center, rightMid, bottomRight, bottomMid],
  };
}

/** Sub-quad polygons for a two-quadrant split of a calibrated arena quad. */
export function arenaQuadTwoRegions(corners: ArenaQuad["corners"], axis: "x" | "y"): Record<TwoQuadrant, PolygonPoint[]> {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const { topMid, rightMid, bottomMid, leftMid } = arenaQuadLandmarks(corners);
  if (axis === "x") {
    return {
      min: [topLeft, topMid, bottomMid, bottomLeft],
      max: [topMid, topRight, bottomRight, bottomMid],
    };
  }
  return {
    min: [topLeft, topRight, rightMid, leftMid],
    max: [leftMid, rightMid, bottomRight, bottomLeft],
  };
}

/**
 * Zone containing a normalized position, or null when the point falls
 * outside every zone (zones need not tile the whole arena). The first
 * matching zone wins if zones overlap.
 */
export function zoneOfPolygons(zones: readonly PolygonZone[], x: number, y: number): string | null {
  for (const zone of zones) {
    if (pointInPolygon(zone.points, x, y)) return zone.id;
  }
  return null;
}

/**
 * Which side of a calibrated arena quad's vertical (left/right) split a
 * point falls on. Derived from the quad's own top/bottom edge midpoints
 * (see arenaQuadLandmarks) rather than a naive x-coordinate compare, so it
 * stays correct under perspective skew. Exact-on-the-line counts as right,
 * matching quadrantOf's half-open boundary convention.
 */
function isRightOfArenaQuad(corners: ArenaQuad["corners"], x: number, y: number): boolean {
  const { topMid, bottomMid } = arenaQuadLandmarks(corners);
  return sideOfLine(topMid, bottomMid, { x, y }) <= 0;
}

/** Which side of a calibrated arena quad's horizontal (top/bottom) split a point falls on. */
function isBottomOfArenaQuad(corners: ArenaQuad["corners"], x: number, y: number): boolean {
  const { leftMid, rightMid } = arenaQuadLandmarks(corners);
  return sideOfLine(leftMid, rightMid, { x, y }) >= 0;
}

/**
 * Assign a normalized position to one of the field's spatial quadrants/zones.
 * The exact 0.5 boundary belongs to the max side: right for x, bottom for y.
 * Polygon zones return null when the point isn't inside any defined zone.
 */
export function quadrantOfField(field: FourQuadrantField, x: number, y: number): FourQuadrant;
export function quadrantOfField(field: TwoQuadrantField, x: number, y: number): TwoQuadrant;
export function quadrantOfField(field: PolygonZonesField, x: number, y: number): string | null;
export function quadrantOfField(field: PositionField, x: number, y: number): PositionQuadrant | null;
export function quadrantOfField(field: PositionField, x: number, y: number): PositionQuadrant | null {
  if (field.type !== "polygon-zones" && field.arena !== undefined) {
    const arena = field.arena;
    if (arena.type === "ellipse") {
      const normalizedX = (x - arena.centerX) / arena.radiusX;
      const normalizedY = (y - arena.centerY) / arena.radiusY;
      if (normalizedX * normalizedX + normalizedY * normalizedY > 1) return null;
    } else if (!pointInPolygon(arena.corners, x, y)) {
      return null;
    }
  }
  if (field.type === "four-quadrant") {
    if (field.arena === undefined) return quadrantOf(x, y);
    const arena = field.arena;
    const right = arena.type === "ellipse" ? x >= arena.centerX : isRightOfArenaQuad(arena.corners, x, y);
    const bottom = arena.type === "ellipse" ? y >= arenaEllipseSplitY(arena) : isBottomOfArenaQuad(arena.corners, x, y);
    if (right) return bottom ? "q4" : "q1";
    return bottom ? "q3" : "q2";
  }
  if (field.type === "two-quadrant") {
    if (field.arena === undefined) {
      const coordinate = field.axis === "x" ? x : y;
      const boundary = field.axis === "x" ? field.splitX ?? 0.5 : 0.5;
      return coordinate >= boundary ? "max" : "min";
    }
    const arena = field.arena;
    if (arena.type === "ellipse") {
      const coordinate = field.axis === "x" ? x : y;
      const boundary = field.axis === "x" ? arena.centerX : arenaEllipseSplitY(arena);
      return coordinate >= boundary ? "max" : "min";
    }
    const isMax = field.axis === "x" ? isRightOfArenaQuad(arena.corners, x, y) : isBottomOfArenaQuad(arena.corners, x, y);
    return isMax ? "max" : "min";
  }
  return zoneOfPolygons(field.zones, x, y);
}

export function quadrantsOfField(field: FourQuadrantField): typeof FOUR_QUADRANTS;
export function quadrantsOfField(field: TwoQuadrantField): typeof TWO_QUADRANTS;
export function quadrantsOfField(field: PolygonZonesField): string[];
export function quadrantsOfField(field: PositionField): typeof FOUR_QUADRANTS | typeof TWO_QUADRANTS | string[];
export function quadrantsOfField(field: PositionField): typeof FOUR_QUADRANTS | typeof TWO_QUADRANTS | string[] {
  if (field.type === "four-quadrant") return FOUR_QUADRANTS;
  if (field.type === "two-quadrant") return TWO_QUADRANTS;
  return field.zones.map((zone) => zone.id);
}

export * from "./resolution.js";
