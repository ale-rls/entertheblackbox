import { monitorIdSchema } from "@entertheblackbox/scenario";
import { z } from "zod";
import {
  audienceGroupSchema,
  fourQuadrantFieldSchema,
  phaseSchema,
  polygonZonesFieldSchema,
  quadrantSchema,
  twoQuadrantFieldSchema,
  twoQuadrantSchema,
} from "@entertheblackbox/scenario/schema";

/**
 * WebSocket protocol (plan §7). All messages are JSON with a discriminator
 * field `t` and a protocol version `v`.
 */

export const PROTOCOL_VERSION = 2;

/** Private WebSocket close code: the visit ended and the phone must scan a fresh QR. */
export const SHOW_ENDED_CLOSE_CODE = 4003;

/**
 * Private WebSocket close code: a newer display connection has taken over
 * the single authenticated display slot. The replaced side must NOT
 * auto-reconnect on this code -- doing so would immediately replace the
 * new connection right back, and if two displays are both open (e.g. two
 * tabs/devices), each side's own reconnect would perpetually kick the
 * other in an infinite loop.
 */
export const DISPLAY_REPLACED_CLOSE_CODE = 4002;

const v = z.literal(PROTOCOL_VERSION);
const nonEmpty = z.string().min(1);
/** Epoch-milliseconds timestamp as exchanged on the wire. */
const timestamp = z.number().finite();

/**
 * Wire form of PhaseSnapshot (plan §5): the phase plus timing metadata.
 * Kept structural (intersection) so it stays in lockstep with the
 * scenario package's Phase union.
 */
/**
 * Resolved curtain-light presentation for a vote on a curtain-light group's
 * timeline. The phase's own `field` is already the counting field (with its
 * neutral gap applied), so display lighting and server counting agree.
 */
export const curtainTreatmentSchema = z.object({
  type: z.literal("curtain-light"),
  curtain: z.object({
    src: nonEmpty,
    baked: z.number().finite(),
    folds: z.number().finite(),
    shine: z.number().finite(),
    shadow: z.number().finite(),
    poolBase: z.number().finite(),
    poolGain: z.number().finite(),
    cursorFlood: z.number().finite(),
    cursorFloodCounted: z.number().finite(),
    neutralGap: z.number().finite(),
  }),
  /** Answer id → colour, defaults already resolved. */
  answerColors: z.record(z.string(), z.string()),
  /** Where cursors appear on first interaction (neutral), or null if the layout has none. */
  entry: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
});

export const phaseSnapshotSchema = z.intersection(
  phaseSchema,
  z.object({
    scenarioVersion: nonEmpty,
    startedAt: timestamp,
    deadlineAt: timestamp.nullable(),
    voteTreatment: curtainTreatmentSchema.optional(),
  }),
);

/** One cursor in a display batch. Shape is ours to define (plan leaves it open). */
export const cursorSchema = z.object({
  clientId: nonEmpty,
  x: z.number().finite(),
  y: z.number().finite(),
  color: nonEmpty,
  /** Set only for a replayed past-participant cursor (see apps/server/src/ghosts). Omitted for live cursors. */
  ghost: z.boolean().optional(),
  /** Increments each time the participant touches their phone control (curtain-light votes). */
  pulse: z.number().int().nonnegative().optional(),
});

export const fourQuadrantCountsSchema = z.object({
  q1: z.number().int().nonnegative(),
  q2: z.number().int().nonnegative(),
  q3: z.number().int().nonnegative(),
  q4: z.number().int().nonnegative(),
});

export const twoQuadrantCountsSchema = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});

/** Compatibility name for the original four-quadrant counts schema. */
export const quadrantCountsSchema = fourQuadrantCountsSchema;

export const polygonZonesCountsSchema = z.record(z.string().min(1), z.number().int().nonnegative());

// ---------------------------------------------------------------- phone → server

export const joinSchema = z.object({
  t: z.literal("join"),
  v,
  clientVersion: nonEmpty,
  installationId: nonEmpty,
  roomId: nonEmpty,
  name: z.string().trim().min(1).max(40),
  // Deliberately not nonEmpty: a returning participant with a still-valid
  // participantLease doesn't need a grant at all (admission/controller.ts's
  // returningParticipant bypass), and an empty/garbage grant otherwise
  // already gets a graceful join_rejected from verifyJoinGrant (which
  // safely returns null on malformed input) -- rejecting the whole
  // message here instead would turn either case into a silent
  // close-and-retry loop with no user-facing explanation.
  joinGrant: z.string().optional(),
  participantLease: nonEmpty.optional(),
});

export const inputSchema = z.object({
  t: z.literal("input"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  // Normalized 0..1; out-of-range finite values are accepted here and
  // clamped by the server (plan §7), so a slightly-off client is not
  // disconnected for rounding errors.
  x: z.number().finite(),
  y: z.number().finite(),
  /** Set on the first sample of a touch. Older apps omit it; the server then infers touches from pauses. */
  touch: z.literal("start").optional(),
});

export const clockTimingSchema = z.object({
  calibrated: z.boolean(),
  offsetMs: z.number().finite(),
  roundTripMs: z.number().finite().nonnegative().nullable(),
  sampleAgeMs: z.number().finite().nonnegative().nullable(),
  elapsedMs: z.number().finite(),
  mode: z.enum(["display", "synchronized", "stream", "none"]),
  media: z.array(z.object({
    role: z.enum(["main", "extra"]),
    positionMs: z.number().finite().nonnegative().nullable(),
    targetMs: z.number().finite().nonnegative().nullable(),
    driftMs: z.number().finite().nullable(),
    state: z.enum(["playing", "paused", "seeking", "loading", "ended", "error", "disabled", "waiting", "ready"]),
  })).max(2),
});
export type ClockTiming = z.infer<typeof clockTimingSchema>;
const phoneTimingSchema = z.object({
  sessionId: nonEmpty, phaseId: nonEmpty, phaseEpoch: z.number().int().nonnegative(),
  routingEpoch: z.number().int().nonnegative(), timing: clockTimingSchema,
});
export type PhoneTiming = z.infer<typeof phoneTimingSchema>;
export type TimingMonitor = {
  id: string; label: string; kind: "display" | "phone"; phaseId: string; phaseEpoch: number;
  connected: boolean; mediaExpected: boolean; reportAgeMs: number | null; timing: ClockTiming | null;
};

export const pingSchema = z.object({
  t: z.literal("ping"),
  v,
  timing: phoneTimingSchema.optional(),
  clientTime: timestamp,
});

/**
 * Applause/boo tap during a rating-enabled video phase (plan §7 extension).
 * Unlimited per participant -- each tap increments a live server-side
 * counter, it never replaces a prior vote the way `input` positions do.
 */
export const reactionSchema = z.object({
  t: z.literal("reaction"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  kind: z.enum(["applause", "boo"]),
});

/** Participant choice during an authored self-select group branch. */
export const groupSelectionSchema = z.object({
  t: z.literal("group_selection"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  groupId: nonEmpty,
});

/** A direct phone-button answer, represented by one of the active field's stable outcome IDs. */
export const buttonVoteSchema = z.object({
  t: z.literal("button_vote"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  outcome: nonEmpty,
});

/**
 * Native tablet → server: video wall progress, so Admin can see which
 * tablets have their slice and how far each is from the shared clock.
 */
export const wallStatusSchema = z.object({
  t: z.literal("wall_status"),
  v,
  clip: z.string().min(1).max(100).nullable(),
  state: z.enum(["idle", "downloading", "ready", "playing", "ended", "error"]),
  /** Playback position minus the expected position, in milliseconds (positive = ahead). */
  driftMs: z.number().finite().optional(),
  detail: z.string().max(300).optional(),
});

export const phoneToServerSchema = z.discriminatedUnion("t", [
  wallStatusSchema,
  joinSchema,
  inputSchema,
  pingSchema,
  reactionSchema,
  groupSelectionSchema,
  buttonVoteSchema,
]);

// -------------------------------------------------------------- display → server

export const displayJoinSchema = z.object({
  t: z.literal("display_join"),
  /** Dedicated main-timeline monitor; never occupies the main display slot. */
  monitorId: monitorIdSchema.optional(),
  /** Omit for the main display. Group displays only render that group's path. */
  groupId: z.string().min(1).optional(),
  /**
   * A signage kiosk (e.g. a lobby entrance screen): QR grant only, no
   * phase/cursor data. Only one client (this connection) ever sets this,
   * never alongside groupId; the server treats signageId as taking
   * precedence if both were somehow present.
   */
  signageId: z.string().min(1).optional(),
  v,
  clientVersion: nonEmpty,
  installationId: nonEmpty,
  roomId: nonEmpty,
  displayToken: nonEmpty,
});

export const videoEndedSchema = z.object({
  t: z.literal("video_ended"),
  v,
  sessionId: nonEmpty,
  phaseId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  mediaId: nonEmpty,
});

export const displayHeartbeatSchema = z.object({
  t: z.literal("display_heartbeat"),
  v,
  timing: clockTimingSchema.optional(),
  sessionId: nonEmpty,
  phaseId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  clientTime: timestamp,
});

export const displayPlaybackStatusSchema = z.object({
  t: z.literal("display_playback_status"),
  v,
  sessionId: nonEmpty,
  phaseId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  mediaId: nonEmpty,
  status: z.enum(["playing", "stalled", "error", "autoplay-blocked"]),
  detail: z.string().max(500).optional(),
});

export const qrGrantRequestSchema = z.object({
  t: z.literal("qr_grant_request"),
  v,
});

export const displayToServerSchema = z.discriminatedUnion("t", [
  displayJoinSchema,
  videoEndedSchema,
  displayHeartbeatSchema,
  displayPlaybackStatusSchema,
  qrGrantRequestSchema,
]);

/** Everything the server can receive over a socket. */
export const clientToServerSchema = z.discriminatedUnion("t", [
  wallStatusSchema,
  joinSchema,
  inputSchema,
  pingSchema,
  reactionSchema,
  groupSelectionSchema,
  buttonVoteSchema,
  displayJoinSchema,
  videoEndedSchema,
  displayHeartbeatSchema,
  displayPlaybackStatusSchema,
  qrGrantRequestSchema,
]);

// ------------------------------------------------------------ server → all clients

export const snapshotSchema = z.object({
  t: z.literal("snapshot"),
  v,
  sessionId: nonEmpty,
  routingEpoch: z.number().int().nonnegative().optional(),
  currentGroup: audienceGroupSchema.nullable().optional(),
  participantState: z.enum(["choosing", "unassigned", "active", "finished"]).optional(),
  phoneAudioActive: z.boolean().optional(),
  phaseEpoch: z.number().int().nonnegative(),
  phase: phaseSnapshotSchema,
  serverTime: timestamp,
});

export const phaseMessageSchema = z.object({
  t: z.literal("phase"),
  v,
  sessionId: nonEmpty,
  routingEpoch: z.number().int().nonnegative().optional(),
  currentGroup: audienceGroupSchema.nullable().optional(),
  participantState: z.enum(["choosing", "unassigned", "active", "finished"]).optional(),
  phoneAudioActive: z.boolean().optional(),
  phaseEpoch: z.number().int().nonnegative(),
  phase: phaseSnapshotSchema,
  serverTime: timestamp,
});

export const presenceSchema = z.object({
  t: z.literal("presence"),
  v,
  count: z.number().int().nonnegative(),
});

/**
 * Version-mismatch reload instruction (plan §7). This envelope must stay
 * backward-compatible across supported deployments: extend it only with
 * optional fields.
 */
export const reloadSchema = z.object({
  t: z.literal("reload"),
  // Reload is the one cross-version envelope: a v1 client must be able to
  // parse the instruction that tells it to fetch the v2 application shell.
  v: z.union([z.literal(1), v]),
  minVersion: nonEmpty,
  reason: z.enum(["protocol", "scenario", "assets"]),
});

// --------------------------------------------------------------- server → display

export const cursorsSchema = z.object({
  t: z.literal("cursors"),
  v,
  tick: z.number().int().nonnegative(),
  cursors: z.array(cursorSchema),
});

const questionStatusBaseSchema = z.object({
  t: z.literal("question_status"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  connectedCount: z.number().int().nonnegative(),
  positionedCount: z.number().int().nonnegative(),
});

export const fourQuadrantQuestionStatusSchema = questionStatusBaseSchema.extend({
  field: fourQuadrantFieldSchema,
  // Present only when the question's showLiveCounts is true (plan §7).
  quadrantCounts: fourQuadrantCountsSchema.optional(),
});

export const twoQuadrantQuestionStatusSchema = questionStatusBaseSchema.extend({
  field: twoQuadrantFieldSchema,
  quadrantCounts: twoQuadrantCountsSchema.optional(),
});

export const polygonZonesQuestionStatusSchema = questionStatusBaseSchema.extend({
  field: polygonZonesFieldSchema,
  quadrantCounts: polygonZonesCountsSchema.optional(),
});

export const questionStatusSchema = z.union([
  fourQuadrantQuestionStatusSchema,
  twoQuadrantQuestionStatusSchema,
  polygonZonesQuestionStatusSchema,
]);

const questionResolvedBaseSchema = z.object({
  t: z.literal("question_resolved"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  resolvedTarget: nonEmpty,
  resolvedAt: timestamp.optional(),
  freezeUntil: timestamp,
  tieBreak: z.object({
    type: z.literal("kleroterion"),
    candidates: z.array(nonEmpty).min(2),
    selected: nonEmpty,
  }).optional(),
});

const nonQuadrantWinnerSchema = z.enum(["tie", "empty", "fixed"]);

export const fourQuadrantQuestionResolvedSchema = questionResolvedBaseSchema.extend({
  field: fourQuadrantFieldSchema,
  quadrantCounts: fourQuadrantCountsSchema,
  // "fixed" means counts remain evidence but no outcome is dramatized.
  winner: z.union([quadrantSchema, nonQuadrantWinnerSchema]),
});

export const twoQuadrantQuestionResolvedSchema = questionResolvedBaseSchema.extend({
  field: twoQuadrantFieldSchema,
  quadrantCounts: twoQuadrantCountsSchema,
  winner: z.union([twoQuadrantSchema, nonQuadrantWinnerSchema]),
});

export const polygonZonesQuestionResolvedSchema = questionResolvedBaseSchema.extend({
  field: polygonZonesFieldSchema,
  quadrantCounts: polygonZonesCountsSchema,
  winner: z.union([z.string().min(1), nonQuadrantWinnerSchema]),
});

export const questionResolvedSchema = z.union([
  fourQuadrantQuestionResolvedSchema,
  twoQuadrantQuestionResolvedSchema,
  polygonZonesQuestionResolvedSchema,
]);

/** Live applause/boo tally broadcast while a rating-enabled video plays. */
export const ratingStatusSchema = z.object({
  t: z.literal("rating_status"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  candidateLabel: nonEmpty,
  applause: z.number().int().nonnegative(),
  boo: z.number().int().nonnegative(),
});

export const qrGrantSchema = z.object({
  t: z.literal("qr_grant"),
  v,
  url: nonEmpty,
  expiresAt: timestamp,
  placement: z.enum(["large", "corner"]),
  /** Whether the display should print the stable join URL during the lobby. */
  showJoinUrl: z.boolean().optional(),
});

export const qrHiddenSchema = z.object({
  t: z.literal("qr_hidden"),
  v,
});

export const displayNoticeSchema = z.object({
  t: z.literal("display_notice"),
  v,
  code: z.enum(["display_replaced", "media_not_ready", "reconnecting"]),
  level: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

// ----------------------------------------------------------------- server → phone

export const identitySchema = z.object({
  t: z.literal("identity"),
  v,
  clientId: nonEmpty,
  color: nonEmpty,
  sessionId: nonEmpty,
  participantLease: nonEmpty,
  leaseExpiresAt: timestamp,
});

export const joinRejectedSchema = z.object({
  t: z.literal("join_rejected"),
  v,
  reason: z.enum(["expired_grant", "room_full", "rate_limited", "show_in_progress"]),
  retryAfterMs: z.number().int().positive().optional(),
});

export const statusSchema = z.object({
  t: z.literal("status"),
  v,
  phaseId: nonEmpty,
  message: z.string(),
});

export const groupSelectionOptionsSchema = z.object({
  t: z.literal("group_selection_options"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  title: z.string().optional(),
  groups: z.array(z.object({
    id: nonEmpty,
    label: nonEmpty,
    color: z.string().optional(),
  })).min(2),
  selectedGroupId: nonEmpty.nullable(),
});

export const votingOptionsSchema = z.object({
  t: z.literal("voting_options"),
  v,
  sessionId: nonEmpty,
  phaseEpoch: z.number().int().nonnegative(),
  method: z.enum(["physical", "phone-cursor", "phone-buttons"]),
  closed: z.boolean().optional(),
  question: z.string(),
  options: z.array(z.object({ id: nonEmpty, label: nonEmpty })),
});

export const pongSchema = z.object({
  t: z.literal("pong"),
  v,
  echoClientTime: timestamp,
  serverTime: timestamp,
});

/** Sent when an admin live-switches the personal-audio backend (SPEC in services/audio) -- the phone must re-point its <audio> element at this URL without a page reload. */
export const audioBridgeChangedSchema = z.object({
  t: z.literal("audio_bridge_changed"),
  v,
  streamUrl: nonEmpty,
});

/**
 * Native show-mode surface colour, scheduled on the shared server clock.
 * `set` changes the base colour; `flash` overlays a colour (cleared after
 * `holdMs`, or held until `release`); `label` asks the device to show its
 * label large (Identify). `seq` is per-server monotonic so late or reordered
 * messages are ignored.
 */
export const surfaceSchema = z.object({
  t: z.literal("surface"),
  v,
  mode: z.enum(["set", "flash", "release"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  applyAt: timestamp,
  seq: z.number().int().nonnegative(),
  holdMs: z.number().int().positive().max(60_000).optional(),
  label: z.string().min(1).max(40).optional(),
});

/**
 * Video wall state for one device (each tablet gets its own slice). `clip`
 * null = no wall clip (show the surface colour). `startAt` null = loaded and
 * paused on the first frame; otherwise playback position is
 * (serverNow − startAt), on the shared server clock. Idempotent: the latest
 * `seq` wins, and joining devices receive the current state.
 */
export const wallSchema = z.object({
  t: z.literal("wall"),
  v,
  seq: z.number().int().nonnegative(),
  clip: z.object({
    id: z.string().min(1).max(100),
    slot: z.string().regex(/^[A-Z][0-9]{1,2}$/),
    /** Same-origin path of this device's slice, e.g. /media/ocean__A1.mp4 */
    url: z.string().startsWith("/").max(500),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).nullable(),
  startAt: timestamp.nullable(),
  loop: z.boolean(),
});

/** Everything a client can receive from the server. */
export const serverToClientSchema = z.union([
  snapshotSchema,
  phaseMessageSchema,
  presenceSchema,
  reloadSchema,
  cursorsSchema,
  questionStatusSchema,
  questionResolvedSchema,
  ratingStatusSchema,
  qrGrantSchema,
  qrHiddenSchema,
  displayNoticeSchema,
  identitySchema,
  joinRejectedSchema,
  statusSchema,
  groupSelectionOptionsSchema,
  votingOptionsSchema,
  pongSchema,
  audioBridgeChangedSchema,
  surfaceSchema,
  wallSchema,
]);

// ------------------------------------------------------------------------- types

export type PhaseSnapshotMessage = z.infer<typeof phaseSnapshotSchema>;
export type CurtainTreatment = z.infer<typeof curtainTreatmentSchema>;
export type Cursor = z.infer<typeof cursorSchema>;
export type QuadrantCounts = z.infer<typeof quadrantCountsSchema>;
export type FourQuadrantCounts = z.infer<typeof fourQuadrantCountsSchema>;
export type TwoQuadrantCounts = z.infer<typeof twoQuadrantCountsSchema>;
export type PolygonZonesCounts = z.infer<typeof polygonZonesCountsSchema>;

export type JoinMessage = z.infer<typeof joinSchema>;
export type InputMessage = z.infer<typeof inputSchema>;
export type PingMessage = z.infer<typeof pingSchema>;
export type ReactionMessage = z.infer<typeof reactionSchema>;
export type GroupSelectionMessage = z.infer<typeof groupSelectionSchema>;
export type ButtonVoteMessage = z.infer<typeof buttonVoteSchema>;
export type PhoneToServerMessage = z.infer<typeof phoneToServerSchema>;

export type DisplayJoinMessage = z.infer<typeof displayJoinSchema>;
export type VideoEndedMessage = z.infer<typeof videoEndedSchema>;
export type DisplayHeartbeatMessage = z.infer<typeof displayHeartbeatSchema>;
export type DisplayPlaybackStatusMessage = z.infer<typeof displayPlaybackStatusSchema>;
export type QrGrantRequestMessage = z.infer<typeof qrGrantRequestSchema>;
export type DisplayToServerMessage = z.infer<typeof displayToServerSchema>;

export type ClientToServerMessage = z.infer<typeof clientToServerSchema>;

export type SnapshotMessage = z.infer<typeof snapshotSchema>;
export type PhaseMessage = z.infer<typeof phaseMessageSchema>;
export type PresenceMessage = z.infer<typeof presenceSchema>;
export type ReloadMessage = z.infer<typeof reloadSchema>;
export type CursorsMessage = z.infer<typeof cursorsSchema>;
export type QuestionStatusMessage = z.infer<typeof questionStatusSchema>;
export type QuestionResolvedMessage = z.infer<typeof questionResolvedSchema>;
export type RatingStatusMessage = z.infer<typeof ratingStatusSchema>;
export type QrGrantMessage = z.infer<typeof qrGrantSchema>;
export type QrHiddenMessage = z.infer<typeof qrHiddenSchema>;
export type DisplayNoticeMessage = z.infer<typeof displayNoticeSchema>;
export type IdentityMessage = z.infer<typeof identitySchema>;
export type JoinRejectedMessage = z.infer<typeof joinRejectedSchema>;
export type StatusMessage = z.infer<typeof statusSchema>;
export type PongMessage = z.infer<typeof pongSchema>;
export type AudioBridgeChangedMessage = z.infer<typeof audioBridgeChangedSchema>;
export type SurfaceMessage = z.infer<typeof surfaceSchema>;
export type WallMessage = z.infer<typeof wallSchema>;
export type WallStatusMessage = z.infer<typeof wallStatusSchema>;
export type ServerToClientMessage = z.infer<typeof serverToClientSchema>;
