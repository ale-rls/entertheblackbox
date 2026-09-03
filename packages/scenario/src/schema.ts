import { z } from "zod";
import { FOUR_QUADRANTS, TWO_QUADRANTS } from "@smartphonecracy/shared";
import { mediaCombinationError } from "./media-kind.js";

const unitCoordinateSchema = z.number().min(0).max(1);

/**
 * Zod schemas for the scenario model (plan §5).
 * Structural validity lives here; graph-level checks live in validate.ts.
 */

export const quadrantSchema = z.enum(FOUR_QUADRANTS);
export const twoQuadrantSchema = z.enum(TWO_QUADRANTS);
export const twoQuadrantVariantSchema = z.enum(["split", "spectrum"]);

export const positionVoteStatusSchema = z.enum([
  "valid",
  "never-moved",
  "stale",
  "disconnected",
]);

/** Statuses that can contribute to a quadrant count ("never-moved" has no coordinates). */
export const countablePositionVoteStatusSchema = z.enum([
  "valid",
  "stale",
  "disconnected",
]);

const phaseIdSchema = z.string().min(1, "phase id must be non-empty");

export const axisSchema = z.object({
  minLabel: z.string().min(1, "axis label must be non-empty"),
  maxLabel: z.string().min(1, "axis label must be non-empty"),
});

export const arenaEllipseSchema = z.object({
  type: z.literal("ellipse"),
  centerX: unitCoordinateSchema,
  centerY: unitCoordinateSchema,
  radiusX: z.number().positive().max(1),
  radiusY: z.number().positive().max(1),
  splitY: unitCoordinateSchema.optional(),
}).refine(
  (ellipse) => ellipse.centerX - ellipse.radiusX >= 0 && ellipse.centerX + ellipse.radiusX <= 1,
  { message: "arena ellipse must fit horizontally inside the display", path: ["radiusX"] },
).refine(
  (ellipse) => ellipse.centerY - ellipse.radiusY >= 0 && ellipse.centerY + ellipse.radiusY <= 1,
  { message: "arena ellipse must fit vertically inside the display", path: ["radiusY"] },
).refine(
  (ellipse) => ellipse.splitY === undefined
    || (ellipse.splitY >= ellipse.centerY - ellipse.radiusY && ellipse.splitY <= ellipse.centerY + ellipse.radiusY),
  { message: "arena ellipse split must lie inside the ellipse", path: ["splitY"] },
);

export const polygonPointSchema = z.object({
  x: unitCoordinateSchema,
  y: unitCoordinateSchema,
});

/**
 * Perspective-calibrated alternative to arenaEllipseSchema: the voting
 * surface's four corners as they actually appear in the shot, in on-screen
 * order starting top-left. Preferred over the ellipse when the filmed
 * floor is visibly skewed by camera angle -- see arenaQuadLandmarks in
 * @smartphonecracy/shared for how the split lines are derived from it.
 */
export const arenaQuadSchema = z.object({
  type: z.literal("quad"),
  corners: z.tuple([polygonPointSchema, polygonPointSchema, polygonPointSchema, polygonPointSchema]),
}).refine(
  (quad) => {
    const [topLeft, topRight, bottomRight, bottomLeft] = quad.corners;
    const area = Math.abs(
      topLeft.x * topRight.y - topRight.x * topLeft.y
      + topRight.x * bottomRight.y - bottomRight.x * topRight.y
      + bottomRight.x * bottomLeft.y - bottomLeft.x * bottomRight.y
      + bottomLeft.x * topLeft.y - topLeft.x * bottomLeft.y,
    ) / 2;
    return area > 0.01;
  },
  { message: "arena quad corners must enclose a visible area", path: ["corners"] },
);

export const arenaSchema = z.union([arenaEllipseSchema, arenaQuadSchema]);

export const fourQuadrantFieldSchema = z.object({
  type: z.literal("four-quadrant"),
  xAxis: axisSchema,
  yAxis: axisSchema,
  arena: arenaSchema.optional(),
});

export const twoQuadrantFieldSchema = z.object({
  type: z.literal("two-quadrant"),
  axis: z.enum(["x", "y"]),
  variant: twoQuadrantVariantSchema.default("spectrum"),
  labels: axisSchema,
  arena: arenaSchema.optional(),
});

export const polygonZoneSchema = z.object({
  id: phaseIdSchema,
  label: z.string().min(1, "zone label must be non-empty"),
  points: z.array(polygonPointSchema).min(3, "a zone polygon needs at least 3 points"),
});

export const polygonZonesFieldSchema = z.object({
  type: z.literal("polygon-zones"),
  zones: z
    .array(polygonZoneSchema)
    .min(1, "polygon-zones needs at least 1 zone")
    .refine((zones) => new Set(zones.map((zone) => zone.id)).size === zones.length, {
      message: "zone ids must be unique",
    }),
});

export const positionFieldSchema = z.discriminatedUnion("type", [
  fourQuadrantFieldSchema,
  twoQuadrantFieldSchema,
  polygonZonesFieldSchema,
]);

const fixedPositionQuestionNextSchema = z.object({
  type: z.literal("fixed"),
  target: phaseIdSchema,
});

export const tieBreakSchema = z.object({
  /** Deterministic draw among the candidates tied for the highest count. */
  type: z.literal("kleroterion"),
});

export const fourQuadrantPluralityNextSchema = z.object({
  type: z.literal("quadrant-plurality"),
  // z.record would accept partial maps; an explicit object requires all four quadrants.
  map: z.object({
    q1: phaseIdSchema,
    q2: phaseIdSchema,
    q3: phaseIdSchema,
    q4: phaseIdSchema,
  }),
  tie: phaseIdSchema,
  empty: phaseIdSchema,
  countedStatuses: z
    .array(countablePositionVoteStatusSchema)
    .nonempty("countedStatuses must include at least one status")
    .refine((s) => new Set(s).size === s.length, {
      message: "countedStatuses must not contain duplicates",
    }),
  tieBreak: tieBreakSchema.optional(),
});

export const twoQuadrantPluralityNextSchema = z.object({
  type: z.literal("quadrant-plurality"),
  map: z.object({
    min: phaseIdSchema,
    max: phaseIdSchema,
  }),
  tie: phaseIdSchema,
  empty: phaseIdSchema,
  countedStatuses: z
    .array(countablePositionVoteStatusSchema)
    .nonempty("countedStatuses must include at least one status")
    .refine((s) => new Set(s).size === s.length, {
      message: "countedStatuses must not contain duplicates",
    }),
  tieBreak: tieBreakSchema.optional(),
});

export const polygonZonesPluralityNextSchema = z.object({
  type: z.literal("quadrant-plurality"),
  // Keyed by zone id; cross-checked against field.zones in the phase-level refine below.
  map: z.record(z.string().min(1), phaseIdSchema),
  tie: phaseIdSchema,
  empty: phaseIdSchema,
  countedStatuses: z
    .array(countablePositionVoteStatusSchema)
    .nonempty("countedStatuses must include at least one status")
    .refine((s) => new Set(s).size === s.length, {
      message: "countedStatuses must not contain duplicates",
    }),
  tieBreak: tieBreakSchema.optional(),
});

export const positionQuestionNextSchema = z.union([
  fixedPositionQuestionNextSchema,
  fourQuadrantPluralityNextSchema,
  twoQuadrantPluralityNextSchema,
  polygonZonesPluralityNextSchema,
]);

export const idlePhaseSchema = z.object({
  kind: z.literal("idle"),
  id: z.literal("idle"),
});

/**
 * Enables live 👏/👎 tallying from phones while timed media plays. Purely a
 * displayed signal — it never affects `next`, which stays fixed like any
 * other video phase.
 */
export const ratingConfigSchema = z.object({
  /** Shown on the live meter, e.g. the candidate's name. */
  candidateLabel: z.string().min(1, "candidateLabel must be non-empty"),
  windows: z.array(z.object({
    startAtMs: z.number().int().nonnegative(),
    endAtMs: z.number().int().positive(),
  }).refine((window) => window.startAtMs < window.endAtMs, {
    message: "reaction window start must be before end",
    path: ["startAtMs"],
  })).optional(),
});

export const subtitleSchema = z.object({
  text: z.string().min(1, "subtitle text must be non-empty"),
  startAtMs: z.number().int().nonnegative(),
  endAtMs: z.number().int().positive(),
}).refine((subtitle) => subtitle.startAtMs < subtitle.endAtMs, {
  message: "subtitle start must be before end",
  path: ["startAtMs"],
});

export const videoPhaseSchema = z.object({
  kind: z.literal("video"),
  id: phaseIdSchema,
  title: z.string().min(1, "title must be non-empty").optional(),
  src: z.string().min(1, "media src must be non-empty"),
  /** When present, src is a still image and this MP3 drives playback/timing. */
  audioSrc: z.string().min(1, "audioSrc must be non-empty").optional(),
  /** Silent visual hold after video or image + MP3 playback ends. */
  tailDurationMs: z.number().int().nonnegative().optional(),
  expectedDurationMs: z.number().int().positive(),
  next: phaseIdSchema,
  allowSkip: z.boolean().optional(),
  /** Whether display renders live/ghost cursors during this phase. Defaults to true when omitted. */
  showCursors: z.boolean().optional(),
  rating: ratingConfigSchema.optional(),
  subtitles: z.array(subtitleSchema).optional(),
}).superRefine((phase, ctx) => {
  const problem = mediaCombinationError(phase.src, phase.audioSrc);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: [phase.audioSrc === undefined ? "src" : "audioSrc"] });
  phase.subtitles?.forEach((subtitle, index) => {
    if (subtitle.endAtMs > phase.expectedDurationMs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "subtitle must end within the phase", path: ["subtitles", index, "endAtMs"] });
  });
  phase.rating?.windows?.forEach((window, index) => {
    if (window.endAtMs > phase.expectedDurationMs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reaction window must end within the phase", path: ["rating", "windows", index, "endAtMs"] });
  });
});

const positionQuestionBaseSchema = z.object({
  kind: z.literal("position-question"),
  id: phaseIdSchema,
  title: z.string().min(1, "title must be non-empty").optional(),
  text: z.string().min(1, "question text must be non-empty"),
  durationMs: z.number().int().positive(),
  freezeMs: z.number().int().nonnegative(),
  connectionStaleAfterMs: z.number().int().positive(),
  showLiveCounts: z.boolean(),
  /** Whether display renders live/ghost cursors during this phase. Defaults to true when omitted. */
  showCursors: z.boolean().optional(),
  /** Whether continuous spectra bloom with cursor-density heat. Defaults to true when omitted. */
  spectrumGlow: z.boolean().optional(),
});

const polygonZonesQuestionVariantSchema = positionQuestionBaseSchema
  .extend({
    field: polygonZonesFieldSchema,
    next: z.union([fixedPositionQuestionNextSchema, polygonZonesPluralityNextSchema]),
  })
  .superRefine((phase, ctx) => {
    if (phase.next.type !== "quadrant-plurality") return;
    const zoneIds = new Set(phase.field.zones.map((zone) => zone.id));
    const mapKeys = Object.keys(phase.next.map);
    const mismatch = mapKeys.length !== zoneIds.size || mapKeys.some((id) => !zoneIds.has(id));
    if (mismatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "next.map keys must exactly match field.zones ids",
        path: ["next", "map"],
      });
    }
  });

const canonicalPositionQuestionPhaseSchema = z.union([
  positionQuestionBaseSchema.extend({
    field: fourQuadrantFieldSchema,
    next: z.union([fixedPositionQuestionNextSchema, fourQuadrantPluralityNextSchema]),
  }),
  positionQuestionBaseSchema.extend({
    field: twoQuadrantFieldSchema,
    next: z.union([fixedPositionQuestionNextSchema, twoQuadrantPluralityNextSchema]),
  }),
  polygonZonesQuestionVariantSchema,
]);

const videoPositionQuestionBaseSchema = z.object({
  kind: z.literal("video-position-question"),
  id: phaseIdSchema,
  title: z.string().min(1, "title must be non-empty").optional(),
  src: z.string().min(1, "media src must be non-empty"),
  /** When present, src is a still image and this MP3 drives playback/timing. */
  audioSrc: z.string().min(1, "audioSrc must be non-empty").optional(),
  /** Silent visual hold after video or image + MP3 playback ends. */
  tailDurationMs: z.number().int().nonnegative().optional(),
  expectedDurationMs: z.number().int().positive(),
  text: z.string().min(1, "question text must be non-empty"),
  /** Timeline offsets from the start of the timed media. */
  showAtMs: z.number().int().nonnegative(),
  openAtMs: z.number().int().nonnegative(),
  closeAtMs: z.number().int().positive(),
  hideAtMs: z.number().int().positive(),
  connectionStaleAfterMs: z.number().int().positive(),
  showLiveCounts: z.boolean(),
  showCursors: z.boolean().optional(),
  /** Whether continuous spectra bloom with cursor-density heat. Defaults to true when omitted. */
  spectrumGlow: z.boolean().optional(),
  /** Optional applause/boo controls shown alongside the position spectrum. */
  rating: ratingConfigSchema.optional(),
  subtitles: z.array(subtitleSchema).optional(),
  closeCountdownSeconds: z.union([z.literal(5), z.literal(10)]).optional(),
});

const polygonZonesVideoQuestionVariantSchema = videoPositionQuestionBaseSchema
  .extend({
    field: polygonZonesFieldSchema,
    next: z.union([fixedPositionQuestionNextSchema, polygonZonesPluralityNextSchema]),
  })
  .superRefine((phase, ctx) => {
    if (phase.next.type !== "quadrant-plurality") return;
    const zoneIds = new Set(phase.field.zones.map((zone) => zone.id));
    const mapKeys = Object.keys(phase.next.map);
    if (mapKeys.length !== zoneIds.size || mapKeys.some((id) => !zoneIds.has(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "next.map keys must exactly match field.zones ids",
        path: ["next", "map"],
      });
    }
  });

export const videoPositionQuestionPhaseSchema = z.union([
  videoPositionQuestionBaseSchema.extend({
    field: fourQuadrantFieldSchema,
    next: z.union([fixedPositionQuestionNextSchema, fourQuadrantPluralityNextSchema]),
  }),
  videoPositionQuestionBaseSchema.extend({
    field: twoQuadrantFieldSchema,
    next: z.union([fixedPositionQuestionNextSchema, twoQuadrantPluralityNextSchema]),
  }),
  polygonZonesVideoQuestionVariantSchema,
]).superRefine((phase, ctx) => {
  const mediaProblem = mediaCombinationError(phase.src, phase.audioSrc);
  if (mediaProblem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: mediaProblem, path: [phase.audioSrc === undefined ? "src" : "audioSrc"] });
  const ordered = phase.showAtMs <= phase.openAtMs
    && phase.openAtMs < phase.closeAtMs
    && phase.closeAtMs <= phase.hideAtMs
    && phase.hideAtMs <= phase.expectedDurationMs;
  if (!ordered) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "timing must satisfy showAtMs <= openAtMs < closeAtMs <= hideAtMs <= expectedDurationMs",
      path: ["showAtMs"],
    });
  }
  phase.subtitles?.forEach((subtitle, index) => {
    if (subtitle.endAtMs > phase.expectedDurationMs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "subtitle must end within the phase", path: ["subtitles", index, "endAtMs"] });
  });
  phase.rating?.windows?.forEach((window, index) => {
    if (window.endAtMs > phase.expectedDurationMs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reaction window must end within the phase", path: ["rating", "windows", index, "endAtMs"] });
  });
});

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Consume the original top-level xAxis/yAxis question shape and return the
 * canonical four-quadrant field shape. The input is never mutated.
 */
export function normalizePositionQuestionInput(input: unknown): unknown {
  if (!isRecord(input) || input.kind !== "position-question") {
    return input;
  }
  if (input.xAxis === undefined && input.yAxis === undefined) return input;
  const { xAxis, yAxis, ...rest } = input;
  if (input.field !== undefined) return rest;
  if (xAxis === undefined || yAxis === undefined) return rest;
  return {
    ...rest,
    field: { type: "four-quadrant", xAxis, yAxis },
  };
}

export const positionQuestionPhaseSchema = z.preprocess(
  normalizePositionQuestionInput,
  canonicalPositionQuestionPhaseSchema,
);

export const phaseSchema = z.union([
  idlePhaseSchema,
  videoPhaseSchema,
  positionQuestionPhaseSchema,
  videoPositionQuestionPhaseSchema,
]);

const canonicalScenarioSchema = z.object({
  version: z.string().min(1, "scenario version must be non-empty"),
  /** Phase the lobby transitions into when a session starts (plan §6). */
  entryPhaseId: phaseIdSchema,
  /**
   * Cycles are rejected unless explicitly marked intentional (plan §5:
   * "Cycles may be allowed intentionally, but must be explicitly marked").
   */
  cyclesAllowed: z.boolean().default(false),
  phases: z.array(phaseSchema).nonempty("scenario must contain at least one phase"),
  /** Ghost-cursor fill target: live + ghost cursors are topped up to this count. Omitted/0 disables ghosts. */
  targetAudienceSize: z.number().int().nonnegative().optional(),
});

/** Normalize all legacy position questions before unknown-field sidecars are captured. */
export function normalizeScenarioInput(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.phases)) return input;
  return {
    ...input,
    phases: input.phases.map(normalizePositionQuestionInput),
  };
}

export const scenarioSchema = z.preprocess(normalizeScenarioInput, canonicalScenarioSchema);

export const mediaManifestSchema = z.object({
  files: z.array(
    z.object({
      src: z.string().min(1, "media src must be non-empty"),
      bytes: z.number().int().positive(),
      hash: z.string().min(1, "media hash must be non-empty"),
    }),
  ),
});

export type Quadrant = z.infer<typeof quadrantSchema>;
export type TwoQuadrant = z.infer<typeof twoQuadrantSchema>;
export type TwoQuadrantVariant = z.infer<typeof twoQuadrantVariantSchema>;
export type Axis = z.infer<typeof axisSchema>;
export type ArenaEllipse = z.infer<typeof arenaEllipseSchema>;
export type ArenaQuad = z.infer<typeof arenaQuadSchema>;
export type Arena = z.infer<typeof arenaSchema>;
export type FourQuadrantField = z.infer<typeof fourQuadrantFieldSchema>;
export type TwoQuadrantField = z.infer<typeof twoQuadrantFieldSchema>;
export type PositionField = z.infer<typeof positionFieldSchema>;
export type PositionVoteStatus = z.infer<typeof positionVoteStatusSchema>;
export type CountablePositionVoteStatus = z.infer<
  typeof countablePositionVoteStatusSchema
>;
export type PositionQuestionNext = z.infer<typeof positionQuestionNextSchema>;
export type FourQuadrantPluralityNext = z.infer<typeof fourQuadrantPluralityNextSchema>;
export type TwoQuadrantPluralityNext = z.infer<typeof twoQuadrantPluralityNextSchema>;
export type PolygonPoint = z.infer<typeof polygonPointSchema>;
export type PolygonZone = z.infer<typeof polygonZoneSchema>;
export type PolygonZonesField = z.infer<typeof polygonZonesFieldSchema>;
export type PolygonZonesPluralityNext = z.infer<typeof polygonZonesPluralityNextSchema>;
export type RatingConfig = z.infer<typeof ratingConfigSchema>;
export type Subtitle = z.infer<typeof subtitleSchema>;
export type IdlePhase = z.infer<typeof idlePhaseSchema>;
export type VideoPhase = z.infer<typeof videoPhaseSchema>;
export type PositionQuestionPhase = z.infer<typeof positionQuestionPhaseSchema>;
export type VideoPositionQuestionPhase = z.infer<typeof videoPositionQuestionPhaseSchema>;
export type PositionVotePhase = PositionQuestionPhase | VideoPositionQuestionPhase;
export type Phase = z.infer<typeof phaseSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type MediaManifest = z.infer<typeof mediaManifestSchema>;

/** Runtime snapshot of the active phase as sent over the wire (plan §5). */
export type PhaseSnapshot = Phase & {
  scenarioVersion: string;
  startedAt: number;
  deadlineAt: number | null;
};
