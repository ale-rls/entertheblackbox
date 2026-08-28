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
};

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
  arena?: ArenaEllipse | undefined;
};

export type TwoQuadrantField = {
  type: "two-quadrant";
  axis: "x" | "y";
  labels: Axis;
  arena?: ArenaEllipse | undefined;
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
    const normalizedX = (x - field.arena.centerX) / field.arena.radiusX;
    const normalizedY = (y - field.arena.centerY) / field.arena.radiusY;
    if (normalizedX * normalizedX + normalizedY * normalizedY > 1) return null;
  }
  if (field.type === "four-quadrant") {
    if (field.arena === undefined) return quadrantOf(x, y);
    const right = x >= field.arena.centerX;
    const bottom = y >= field.arena.centerY;
    if (right) return bottom ? "q4" : "q1";
    return bottom ? "q3" : "q2";
  }
  if (field.type === "two-quadrant") {
    const coordinate = field.axis === "x" ? x : y;
    const boundary = field.arena === undefined
      ? 0.5
      : field.axis === "x" ? field.arena.centerX : field.arena.centerY;
    return coordinate >= boundary ? "max" : "min";
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
