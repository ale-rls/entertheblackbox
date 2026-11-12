/**
 * Scenario types, validation, and graph utilities (plan §5).
 */

export const SCENARIO_SCHEMA_VERSION = 7;

export {
  arenaEllipseSchema,
  arenaQuadSchema,
  arenaSchema,
  axisSchema,
  countablePositionVoteStatusSchema,
  fourQuadrantFieldSchema,
  fourQuadrantPluralityNextSchema,
  audienceGroupSchema,
  votingMethodSchema,
  groupAssignmentSchema,
  groupBranchPhaseSchema,
  idlePhaseSchema,
  mediaManifestSchema,
  narrationPhaseSchema,
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
  twoQuadrantVariantSchema,
  videoPhaseSchema,
  videoPositionQuestionPhaseSchema,
  normalizePositionQuestionInput,
  normalizeScenarioInput,
  curtainLightSchema,
  curtainLightingSchema,
} from "./schema.js";
export { curtainGroupIds, curtainStagePhaseIds, curtainLightIssues, isCurtainLightVote } from "./curtain.js";
export type {
  Arena,
  ArenaEllipse,
  ArenaQuad,
  Axis,
  AudienceGroup,
  VotingMethod,
  CountablePositionVoteStatus,
  FourQuadrantField,
  FourQuadrantPluralityNext,
  GroupAssignment,
  GroupBranchPhase,
  IdlePhase,
  MediaManifest,
  NarrationPhase,
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
  Subtitle,
  TwoQuadrant,
  TwoQuadrantVariant,
  TwoQuadrantField,
  TwoQuadrantPluralityNext,
  VideoPhase,
  VideoPositionQuestionPhase,
  PositionVotePhase,
  CurtainLightConfig,
  CurtainLightingTuning,
} from "./schema.js";

export { validateScenario } from "./validate.js";
export type { ScenarioIssue, ValidationResult } from "./validate.js";

export { validateMediaManifest } from "./media.js";
export type { MediaIssue, StatSize } from "./media.js";
export { extraAudioCombinationError, mediaCombinationError, mediaKindForSource } from "./media-kind.js";
export type { MediaKind } from "./media-kind.js";

// Quadrant assignment (half-open boundary convention) is shared domain
// logic; re-exported so scenario consumers need not import shared directly.
export { quadrantOf } from "@entertheblackbox/shared";

export * from "./monitors.js";
export * from "./actor-script.js";

export * from './tasks.js';
export * from './admission.js';
