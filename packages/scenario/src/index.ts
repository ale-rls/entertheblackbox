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
  operatorFieldsSchema,
  phoneMusicSchema,
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
export { DEFAULT_VOTE_COUNTDOWN_SECONDS, MAX_VOTE_COUNTDOWN_SECONDS, MIN_VOTE_COUNTDOWN_SECONDS, voteCountdownSeconds, withVoteCountdownSeconds } from "./vote-countdown.js";
export { curtainGroupIds, curtainStagePhaseIds, curtainLightIssues, isCurtainLightVote } from "./curtain.js";
export type { PhoneMusic } from "./schema.js";
export type {
  OperatorFields,
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
export { orderedSurfaceCues, surfaceCueEffect, surfaceCueEffectSchema, surfaceCueSchema, surfaceCuesSchema } from "./surface-cues.js";
export type { SurfaceCue, SurfaceCueEffect } from "./surface-cues.js";
export type { ScenarioIssue, ValidationResult } from "./validate.js";

export { validateMediaManifest } from "./media.js";
export { anyMonitorCountdown, finalMonitorCountdown, MONITOR_FINAL_COUNTDOWN_SECONDS, monitorCountdown, monitorCueCountdown, monitorCueShowsCountdown, monitorsCountThemselves, shownMonitorCountdown, shownMonitorCountdownText } from "./monitor-countdown.js";
export type { MonitorCountdownPhase } from "./monitor-countdown.js";
export { countdownAmount, formatCountdownAmount, sceneCountdownPings, sceneCountdownSchema, sceneCountdownSeconds, sceneCountdownText } from "./scene-countdown.js";
export type { SceneCountdown } from "./scene-countdown.js";
export type { MediaIssue, StatSize } from "./media.js";
export { extraAudioCombinationError, loopVideoCombinationError, mediaCombinationError, mediaKindForSource } from "./media-kind.js";
export type { MediaKind } from "./media-kind.js";

// Quadrant assignment (half-open boundary convention) is shared domain
// logic; re-exported so scenario consumers need not import shared directly.
export { quadrantOf } from "@entertheblackbox/shared";

export * from "./monitors.js";
export * from "./actor-script.js";

export * from './tasks.js';
export * from './admission.js';
