import { z } from "zod";
import { FOUR_QUADRANTS, TWO_QUADRANTS } from "@smartphonecracy/shared";

/**
 * Zod schemas for the scenario model (plan §5).
 * Structural validity lives here; graph-level checks live in validate.ts.
 */

export const quadrantSchema = z.enum(FOUR_QUADRANTS);
export const twoQuadrantSchema = z.enum(TWO_QUADRANTS);

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

export const fourQuadrantFieldSchema = z.object({
  type: z.literal("four-quadrant"),
  xAxis: axisSchema,
  yAxis: axisSchema,
});

export const twoQuadrantFieldSchema = z.object({
  type: z.literal("two-quadrant"),
  axis: z.enum(["x", "y"]),
  labels: axisSchema,
});

export const positionFieldSchema = z.discriminatedUnion("type", [
  fourQuadrantFieldSchema,
  twoQuadrantFieldSchema,
]);

const fixedPositionQuestionNextSchema = z.object({
  type: z.literal("fixed"),
  target: phaseIdSchema,
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
});

export const positionQuestionNextSchema = z.union([
  fixedPositionQuestionNextSchema,
  fourQuadrantPluralityNextSchema,
  twoQuadrantPluralityNextSchema,
]);

export const idlePhaseSchema = z.object({
  kind: z.literal("idle"),
  id: z.literal("idle"),
});

export const videoPhaseSchema = z.object({
  kind: z.literal("video"),
  id: phaseIdSchema,
  src: z.string().min(1, "video src must be non-empty"),
  expectedDurationMs: z.number().int().positive(),
  next: phaseIdSchema,
  allowSkip: z.boolean().optional(),
  /** Whether display renders live/ghost cursors during this phase. Defaults to true when omitted. */
  showCursors: z.boolean().optional(),
});

const positionQuestionBaseSchema = z.object({
  kind: z.literal("position-question"),
  id: phaseIdSchema,
  text: z.string().min(1, "question text must be non-empty"),
  durationMs: z.number().int().positive(),
  freezeMs: z.number().int().nonnegative(),
  connectionStaleAfterMs: z.number().int().positive(),
  showLiveCounts: z.boolean(),
  /** Whether display renders live/ghost cursors during this phase. Defaults to true when omitted. */
  showCursors: z.boolean().optional(),
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
]);

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
export type Axis = z.infer<typeof axisSchema>;
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
export type IdlePhase = z.infer<typeof idlePhaseSchema>;
export type VideoPhase = z.infer<typeof videoPhaseSchema>;
export type PositionQuestionPhase = z.infer<typeof positionQuestionPhaseSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type MediaManifest = z.infer<typeof mediaManifestSchema>;

/** Runtime snapshot of the active phase as sent over the wire (plan §5). */
export type PhaseSnapshot = Phase & {
  scenarioVersion: string;
  startedAt: number;
  deadlineAt: number | null;
};
