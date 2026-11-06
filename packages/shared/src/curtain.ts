import {
  arenaEllipseSplitY,
  arenaQuadLandmarks,
  centroid,
  fieldSplitOffsets,
  insideFieldArena,
  quadrantOfField,
  quadrantsOfField,
  type PolygonPoint,
  type PositionField,
} from "./index.js";

/**
 * Curtain-light voting: the shared geometry and defaults used by the server
 * (entry position, counting field), the display renderer and the Studio
 * preview. Everything that decides "where does light fall" derives from
 * quadrantOfField / fieldSplitOffsets, so the lit pools are exactly the
 * counting areas and never grow with popularity.
 */

/** Neutral band applied to two-way and four-quadrant curtain votes when the stage does not set one. */
export const CURTAIN_DEFAULT_NEUTRAL_GAP = 0.06;

/** Fabric and light defaults: Silver D / satin from the Curtain Light Lab. */
export const CURTAIN_DEFAULTS = {
  src: "curtain-silverD-satin-packed.mp4",
  fabric: "Silver D · satin",
  baked: 0.1,
  folds: 1.1,
  shine: 1,
  shadow: 0.6,
  /** Pool brightness with no votes, and the extra brightness a full share adds. */
  poolBase: 0.32,
  poolGain: 0.95,
  /** Brightness of one cursor's flood outside / inside a counting area. */
  cursorFlood: 0.35,
  cursorFloodCounted: 0.7,
} as const;

export type CurtainLighting = {
  poolBase: number;
  poolGain: number;
  cursorFlood: number;
  cursorFloodCounted: number;
};

export type CurtainFabric = {
  src: string;
  baked: number;
  folds: number;
  shine: number;
  shadow: number;
};

export type CurtainSettings = CurtainFabric & CurtainLighting & { neutralGap: number };

type Loose<T> = { [K in keyof T]?: T[K] | undefined };

/** System answer colours, assigned in outcome order. Chosen to stay distinct on silver fabric. */
export const CURTAIN_DEFAULT_COLORS = [
  "#ffb347",
  "#4fd1c5",
  "#c77dff",
  "#9be15d",
  "#ff7096",
  "#6fa8ff",
  "#ffd166",
  "#f4978e",
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Resolve the full curtain settings from the scenario-level shared curtain
 * and an optional per-stage tuning override. Unknown or missing values fall
 * back to CURTAIN_DEFAULTS.
 */
export function resolveCurtainSettings(
  shared: Loose<CurtainSettings> | undefined,
  stage?: Loose<CurtainLighting> | undefined,
): CurtainSettings {
  const pick = <K extends keyof CurtainSettings>(key: K, fallback: CurtainSettings[K]): CurtainSettings[K] =>
    (stage as Loose<CurtainSettings> | undefined)?.[key] ?? shared?.[key] ?? fallback;
  return {
    src: shared?.src ?? CURTAIN_DEFAULTS.src,
    baked: pick("baked", CURTAIN_DEFAULTS.baked),
    folds: pick("folds", CURTAIN_DEFAULTS.folds),
    shine: pick("shine", CURTAIN_DEFAULTS.shine),
    shadow: pick("shadow", CURTAIN_DEFAULTS.shadow),
    poolBase: pick("poolBase", CURTAIN_DEFAULTS.poolBase),
    poolGain: pick("poolGain", CURTAIN_DEFAULTS.poolGain),
    cursorFlood: pick("cursorFlood", CURTAIN_DEFAULTS.cursorFlood),
    cursorFloodCounted: pick("cursorFloodCounted", CURTAIN_DEFAULTS.cursorFloodCounted),
    neutralGap: shared?.neutralGap ?? CURTAIN_DEFAULT_NEUTRAL_GAP,
  };
}

/**
 * The counting field a curtain stage actually uses: two-way and four-quadrant
 * fields receive the default neutral band unless the stage set its own
 * (0 is an explicit "no gap"). Custom polygons already leave neutral space
 * between zones and are returned unchanged.
 */
export function curtainVoteField<Field extends PositionField>(field: Field, defaultGap = CURTAIN_DEFAULT_NEUTRAL_GAP): Field {
  if (field.type === "polygon-zones" || field.neutralGap !== undefined) return field;
  return { ...field, neutralGap: defaultGap };
}

/** Answer ids in their stable outcome order. */
export function curtainOutcomes(field: PositionField): string[] {
  return [...quadrantsOfField(field)];
}

/** Per-answer colours: authored overrides where valid, system defaults otherwise. */
export function resolveAnswerColors(
  field: PositionField,
  overrides?: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const colors: Record<string, string> = {};
  curtainOutcomes(field).forEach((id, index) => {
    const authored = overrides?.[id];
    colors[id] = authored !== undefined && HEX.test(authored)
      ? authored
      : CURTAIN_DEFAULT_COLORS[index % CURTAIN_DEFAULT_COLORS.length]!;
  });
  return colors;
}

/** sRGB hex to linear-light RGB (the prototype's ^2.2 convention). */
export function hexToLinear(hex: string): [number, number, number] {
  const value = HEX.test(hex) ? hex : "#ffffff";
  const channel = (offset: number) => (parseInt(value.slice(offset, offset + 2), 16) / 255) ** 2.2;
  return [channel(1), channel(3), channel(5)];
}

/** Where the field's split lines cross: the natural "centre" of the vote. */
export function curtainFieldCenter(field: PositionField): PolygonPoint {
  if (field.type === "polygon-zones") return { x: 0.5, y: 0.5 };
  const arena = field.arena;
  if (arena === undefined) {
    return { x: field.type === "two-quadrant" ? field.splitX ?? 0.5 : 0.5, y: 0.5 };
  }
  if (arena.type === "ellipse") return { x: arena.centerX, y: arenaEllipseSplitY(arena) };
  return arenaQuadLandmarks(arena.corners).center;
}

const ENTRY_MARGIN = 0.012;
const ENTRY_STEP = 0.005;

function robustlyNeutral(field: PositionField, x: number, y: number): boolean {
  // The very edge of the display is never a useful (or reliably classified) entry.
  if (x < 0.03 || x > 0.97 || y < 0.03 || y > 0.97) return false;
  return quadrantOfField(field, x, y) === null
    && quadrantOfField(field, x - ENTRY_MARGIN, y) === null
    && quadrantOfField(field, x + ENTRY_MARGIN, y) === null
    && quadrantOfField(field, x, y - ENTRY_MARGIN) === null
    && quadrantOfField(field, x, y + ENTRY_MARGIN) === null;
}

/**
 * The point where a cursor appears on first interaction: the field centre
 * when it casts no vote, otherwise the nearest point that is neutral with a
 * small safety margin (custom polygons may cover the centre). Prefers points
 * inside a calibrated arena. Null when the layout leaves no neutral space.
 */
export function neutralEntryPoint(field: PositionField): PolygonPoint | null {
  const center = curtainFieldCenter(field);
  let best: { point: PolygonPoint; score: number } | null = null;
  const steps = Math.ceil(1 / ENTRY_STEP);
  for (let ring = 0; ring <= steps; ring += 1) {
    // Any later ring is farther away than this ring's nearest candidate can be.
    if (best !== null && (ring - 1) * ENTRY_STEP > Math.sqrt(best.score)) break;
    for (let i = -ring; i <= ring; i += 1) {
      for (let j = -ring; j <= ring; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = center.x + i * ENTRY_STEP;
        const y = center.y + j * ENTRY_STEP;
        if (!robustlyNeutral(field, x, y)) continue;
        // Leaving the arena is allowed but costs as much as moving 0.3 away.
        const penalty = insideFieldArena(field, x, y) ? 0 : 0.09;
        const score = (x - center.x) ** 2 + (y - center.y) ** 2 + penalty;
        if (best === null || score < best.score) best = { point: { x, y }, score };
      }
    }
  }
  return best === null ? null : { x: Math.round(best.point.x * 1000) / 1000, y: Math.round(best.point.y * 1000) / 1000 };
}

export type CurtainLabel = { text: string; x: number; y: number; outcome?: string };

/**
 * Text anchors for a curtain stage. Two-way splits and polygons label each
 * pool at its lit centre; spectra and four-quadrant fields keep the familiar
 * axis-end labels.
 */
export function curtainLabels(field: PositionField, pools?: PoolMasks): CurtainLabel[] {
  const masks = pools ?? buildPoolMasks(field);
  if (field.type === "polygon-zones") {
    return field.zones.map((zone) => ({ text: zone.label, ...masks.centers[zone.id] ?? centroid(zone.points), outcome: zone.id }));
  }
  const center = curtainFieldCenter(field);
  const extent = masks.extent;
  const along = (axis: "x" | "y", side: -1 | 1): PolygonPoint => {
    const reach = side < 0 ? (axis === "x" ? extent.left : extent.top) : (axis === "x" ? extent.right : extent.bottom);
    const distance = reach * 0.72;
    return axis === "x"
      ? { x: Math.min(0.92, Math.max(0.08, center.x + side * distance)), y: center.y }
      : { x: center.x, y: Math.min(0.9, Math.max(0.2, center.y + side * distance)) };
  };
  if (field.type === "four-quadrant") {
    return [
      { text: field.xAxis.minLabel, ...along("x", -1) },
      { text: field.xAxis.maxLabel, ...along("x", 1) },
      { text: field.yAxis.minLabel, ...along("y", -1) },
      { text: field.yAxis.maxLabel, ...along("y", 1) },
    ];
  }
  if (field.variant === "spectrum") {
    return [
      { text: field.labels.minLabel, ...along(field.axis, -1), outcome: "min" },
      { text: field.labels.maxLabel, ...along(field.axis, 1), outcome: "max" },
    ];
  }
  return [
    { text: field.labels.minLabel, ...masks.centers.min ?? along(field.axis, -1), outcome: "min" },
    { text: field.labels.maxLabel, ...masks.centers.max ?? along(field.axis, 1), outcome: "max" },
  ];
}

export const POOL_GRID_COLUMNS = 192;
export const POOL_GRID_ROWS = 108;

/**
 * Low-resolution per-answer light masks sampled from the counting geometry.
 * A cell is lit for an answer only when quadrantOfField places its centre in
 * that answer; blurring afterwards softens the edges for display without
 * moving any counting boundary. Spectra additionally carry a continuous
 * position weight so colour and light vary with strength of opinion.
 */
export type PoolMasks = {
  columns: number;
  rows: number;
  outcomes: string[];
  /** One soft coverage mask (0..1) per outcome, row-major, top row first. */
  masks: Float32Array[];
  /** Unblurred: the outcome index counted at each cell, -1 for neutral. */
  counted: Int8Array;
  /** Lit centre of each answer (mean of its counted cells). */
  centers: Record<string, PolygonPoint>;
  /** How far the field reaches from its centre on each side, viewport units. */
  extent: { left: number; right: number; top: number; bottom: number };
};

function blur(source: Float32Array, columns: number, rows: number, radius: number): Float32Array {
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const width = radius * 2 + 1;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += source[y * columns + Math.min(columns - 1, Math.max(0, x + k))]!;
      temp[y * columns + x] = sum / width;
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += temp[Math.min(rows - 1, Math.max(0, y + k)) * columns + x]!;
      out[y * columns + x] = sum / width;
    }
  }
  return out;
}

export function buildPoolMasks(field: PositionField, columns = POOL_GRID_COLUMNS, rows = POOL_GRID_ROWS): PoolMasks {
  const outcomes = curtainOutcomes(field);
  const index = new Map(outcomes.map((id, i) => [id, i]));
  const raw = outcomes.map(() => new Float32Array(columns * rows));
  const counted = new Int8Array(columns * rows).fill(-1);
  const sums = outcomes.map(() => ({ x: 0, y: 0, n: 0 }));
  const center = curtainFieldCenter(field);
  const extent = { left: 0, right: 0, top: 0, bottom: 0 };
  const spectrum = field.type === "two-quadrant" && field.variant === "spectrum" ? field : null;
  const offsets = new Float32Array(spectrum ? columns * rows : 0);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) / columns;
      const y = (row + 0.5) / rows;
      const cell = row * columns + column;
      if (insideFieldArena(field, x, y)) {
        extent.left = Math.max(extent.left, center.x - x);
        extent.right = Math.max(extent.right, x - center.x);
        extent.top = Math.max(extent.top, center.y - y);
        extent.bottom = Math.max(extent.bottom, y - center.y);
      }
      if (spectrum) {
        const o = fieldSplitOffsets(spectrum, x, y);
        offsets[cell] = spectrum.axis === "x" ? o.dx : o.dy;
      }
      const outcome = quadrantOfField(field, x, y);
      if (outcome === null) continue;
      const i = index.get(outcome)!;
      counted[cell] = i;
      raw[i]![cell] = 1;
      const sum = sums[i]!;
      sum.x += x; sum.y += y; sum.n += 1;
    }
  }
  if (spectrum) {
    // Opposing washes with a continuous colour transition: every counted
    // cell carries both answer colours, weighted by position along the
    // spectrum, and grows brighter toward the ends (stronger opinion).
    // Cells inside the neutral band stay unlit.
    const reachMin = spectrum.axis === "x" ? extent.left : extent.top;
    const reachMax = spectrum.axis === "x" ? extent.right : extent.bottom;
    const minIndex = index.get("min")!;
    const maxIndex = index.get("max")!;
    for (let cell = 0; cell < counted.length; cell += 1) {
      if (counted[cell]! < 0) continue;
      const d = offsets[cell]!;
      const t = Math.max(-1, Math.min(1, d / Math.max(0.05, d < 0 ? reachMin : reachMax)));
      const strength = 0.3 + 0.7 * Math.abs(t);
      const towardMax = (t + 1) / 2;
      raw[minIndex]![cell] = strength * (1 - towardMax);
      raw[maxIndex]![cell] = strength * towardMax;
    }
  }
  if (!spectrum) {
    // A pool reads as a light, not a filled shape: brightest at its lit
    // centre, falling off toward (never past) its counting boundary.
    const aspect = 16 / 9;
    outcomes.forEach((_, i) => {
      const sum = sums[i]!;
      if (sum.n === 0) return;
      const cx = sum.x / sum.n;
      const cy = sum.y / sum.n;
      const reach = 0.62 * Math.sqrt((sum.n / (columns * rows)) * aspect);
      const mask = raw[i]!;
      for (let cell = 0; cell < mask.length; cell += 1) {
        if (mask[cell] === 0) continue;
        const x = ((cell % columns) + 0.5) / columns;
        const y = (Math.floor(cell / columns) + 0.5) / rows;
        const d2 = (((x - cx) * aspect) ** 2 + (y - cy) ** 2) / (reach * reach);
        mask[cell] = 0.3 + 0.7 * Math.exp(-d2);
      }
    });
  }
  const radius = Math.max(1, Math.round(columns / 96));
  const masks = raw.map((mask) => blur(blur(mask, columns, rows, radius), columns, rows, radius));
  const centers: Record<string, PolygonPoint> = {};
  outcomes.forEach((id, i) => {
    const sum = sums[i]!;
    if (sum.n > 0) centers[id] = { x: sum.x / sum.n, y: sum.y / sum.n };
  });
  return { columns, rows, outcomes, masks, counted, centers, extent };
}

/** Summed soft pool coverage at a position (0 in neutral space, about 1 inside a pool). */
export function poolCoverageAt(pools: PoolMasks, x: number, y: number): number {
  const column = Math.min(pools.columns - 1, Math.max(0, Math.floor(x * pools.columns)));
  const row = Math.min(pools.rows - 1, Math.max(0, Math.floor(y * pools.rows)));
  return pools.masks.reduce((sum, mask) => sum + mask[row * pools.columns + column]!, 0);
}

/** Share of the grid each answer can be counted in (0..1); used by validation. */
export function poolCoverage(pools: PoolMasks): Record<string, number> {
  const cells = new Array<number>(pools.outcomes.length).fill(0);
  for (const i of pools.counted) if (i >= 0) cells[i]! += 1;
  return Object.fromEntries(pools.outcomes.map((id, i) => [id, cells[i]! / pools.counted.length]));
}

/**
 * Target pool brightness per answer from authoritative counts: every pool
 * keeps a base glow (labels and fabric stay readable with no votes) and
 * gains with its share of counted votes. Capped so a landslide cannot
 * flood the fabric.
 */
export function poolIntensities(
  outcomes: readonly string[],
  counts: Readonly<Record<string, number>> | null,
  lighting: Pick<CurtainLighting, "poolBase" | "poolGain">,
): number[] {
  const total = outcomes.reduce((sum, id) => sum + (counts?.[id] ?? 0), 0);
  return outcomes.map((id) => {
    const share = total > 0 ? (counts?.[id] ?? 0) / total : 0;
    return Math.min(lighting.poolBase + lighting.poolGain * share, lighting.poolBase + lighting.poolGain);
  });
}

/**
 * Compose the pool light map (linear RGB, row-major, 3 floats per cell) from
 * the soft masks, the answer colours and the current pool intensities.
 * Overlapping soft edges mix colours, which also gives spectra their
 * continuous transition.
 */
export function composeLightMap(
  pools: PoolMasks,
  colorsLinear: ReadonlyArray<readonly [number, number, number]>,
  intensities: readonly number[],
  out: Float32Array = new Float32Array(pools.columns * pools.rows * 3),
): Float32Array {
  out.fill(0);
  pools.masks.forEach((mask, i) => {
    const [r, g, b] = colorsLinear[i] ?? [1, 1, 1];
    const k = intensities[i] ?? 0;
    if (k <= 0) return;
    for (let cell = 0; cell < mask.length; cell += 1) {
      const m = mask[cell]!;
      if (m <= 0.001) continue;
      out[cell * 3] = out[cell * 3]! + r * m * k;
      out[cell * 3 + 1] = out[cell * 3 + 1]! + g * m * k;
      out[cell * 3 + 2] = out[cell * 3 + 2]! + b * m * k;
    }
  });
  return out;
}

/**
 * Colour a cursor light takes at a position: blended toward the answers
 * whose soft pools are near, white where nothing is lit. Returns linear RGB
 * plus how strongly it is tinted (0..1).
 */
export function cursorTint(
  pools: PoolMasks,
  colorsLinear: ReadonlyArray<readonly [number, number, number]>,
  x: number,
  y: number,
): { rgb: [number, number, number]; weight: number } {
  const column = Math.min(pools.columns - 1, Math.max(0, Math.floor(x * pools.columns)));
  const row = Math.min(pools.rows - 1, Math.max(0, Math.floor(y * pools.rows)));
  const cell = row * pools.columns + column;
  let r = 0; let g = 0; let b = 0; let weight = 0;
  pools.masks.forEach((mask, i) => {
    const m = mask[cell]!;
    if (m <= 0) return;
    const color = colorsLinear[i] ?? [1, 1, 1];
    r += color[0] * m; g += color[1] * m; b += color[2] * m; weight += m;
  });
  const tint = Math.min(1, weight);
  if (weight <= 0) return { rgb: [1, 1, 1], weight: 0 };
  // Mix toward white where the pools are faint, so neutral cursors stay readable.
  return {
    rgb: [r / weight * tint + (1 - tint), g / weight * tint + (1 - tint), b / weight * tint + (1 - tint)],
    weight: tint,
  };
}
