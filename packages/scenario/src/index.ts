/**
 * Scenario types, validation, and graph utilities (plan §5).
 */

export const SCENARIO_SCHEMA_VERSION = 3;

export {
  axisSchema,
  countablePositionVoteStatusSchema,
  fourQuadrantFieldSchema,
  fourQuadrantPluralityNextSchema,
  idlePhaseSchema,
  mediaManifestSchema,
  phaseSchema,
  polygonPointSchema,
  polygonZoneSchema,
  polygonZonesFieldSchema,
  polygonZonesPluralityNextSchema,
  positionQuestionNextSchema,
  positionQuestionPhaseSchema,
  positionFieldSchema,
  positionVoteStatusSchema,
  quadrantSchema,
  ratingConfigSchema,
  scenarioSchema,
  twoQuadrantFieldSchema,
  twoQuadrantPluralityNextSchema,
  twoQuadrantSchema,
  videoPhaseSchema,
  videoPositionQuestionPhaseSchema,
  normalizePositionQuestionInput,
  normalizeScenarioInput,
} from "./schema.js";
export type {
  Axis,
  CountablePositionVoteStatus,
  FourQuadrantField,
  FourQuadrantPluralityNext,
  IdlePhase,
  MediaManifest,
  Phase,
  PhaseSnapshot,
  PolygonPoint,
  PolygonZone,
  PolygonZonesField,
  PolygonZonesPluralityNext,
  PositionQuestionNext,
  PositionQuestionPhase,
  PositionField,
  PositionVoteStatus,
  Quadrant,
  RatingConfig,
  Scenario,
  TwoQuadrant,
  TwoQuadrantField,
  TwoQuadrantPluralityNext,
  VideoPhase,
  VideoPositionQuestionPhase,
  PositionVotePhase,
} from "./schema.js";

export { validateScenario } from "./validate.js";
export type { ScenarioIssue, ValidationResult } from "./validate.js";

export { statSizeWithNodeFs, validateMediaManifest } from "./media.js";
export type { MediaIssue, StatSize } from "./media.js";
export { mediaCombinationError, mediaKindForSource } from "./media-kind.js";
export type { MediaKind } from "./media-kind.js";

// Quadrant assignment (half-open boundary convention) is shared domain
// logic; re-exported so scenario consumers need not import shared directly.
export { quadrantOf } from "@smartphonecracy/shared";
