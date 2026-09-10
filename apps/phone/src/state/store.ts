import type {
  IdentityMessage,
  JoinRejectedMessage,
  ReloadMessage,
  ServerToClientMessage,
} from "@smartphonecracy/protocol";
import type { RatingConfig, Subtitle } from "@smartphonecracy/scenario";

/**
 * Phone state reducer. The phone intentionally renders almost nothing
 * (plan §10): it needs its identity marker, whether cursor input is currently
 * accepted, and join/connection status.
 */

export type JoinState =
  | { kind: "ready" }
  | { kind: "connecting" }
  | { kind: "joining" }
  | { kind: "accepted"; identity: IdentityMessage }
  | { kind: "ended" }
  | { kind: "rejected"; reason: JoinRejectedMessage["reason"]; retryAfterMs?: number };

export type PhoneState = {
  join: JoinState;
  sessionId: string | null;
  phaseEpoch: number;
  /** Cursor input is accepted in the lobby, videos, and position questions. */
  inputOpen: boolean;
  currentPhaseId: string | null;
  statusMessage: string | null;
  reloadRequired: ReloadMessage | null;
  /** Set while the current timed-media phase has applause/boo reactions enabled. */
  ratingCandidateLabel: string | null;
  /** One phone text field: an active subtitle takes precedence over the scene title. */
  phoneDisplayText: string | null;
  phaseTiming: {
    startedAt: number;
    serverOffsetMs: number;
    title: string | null;
    subtitles: readonly Subtitle[];
    rating: RatingConfig | null;
  } | null;
};

export const initialPhoneState: PhoneState = {
  join: { kind: "ready" },
  sessionId: null,
  phaseEpoch: -1,
  inputOpen: false,
  currentPhaseId: null,
  statusMessage: null,
  reloadRequired: null,
  ratingCandidateLabel: null,
  phoneDisplayText: null,
  phaseTiming: null,
};

export type PhoneAction =
  | { type: "server-message"; message: ServerToClientMessage; receivedAtMs?: number }
  | { type: "clock-tick"; nowMs: number }
  | { type: "socket-open" }
  | { type: "socket-lost" }
  | { type: "session-ended" }
  | { type: "reset" };

export function phoneReducer(state: PhoneState, action: PhoneAction): PhoneState {
  if (action.type === "clock-tick") {
    if (state.phaseTiming === null) return state;
    const temporal = temporalFields(state.phaseTiming, action.nowMs);
    return temporal.ratingCandidateLabel === state.ratingCandidateLabel && temporal.phoneDisplayText === state.phoneDisplayText
      ? state
      : { ...state, ...temporal };
  }
  if (action.type === "reset") return initialPhoneState;
  if (action.type === "socket-open") {
    return { ...state, join: { kind: "joining" } };
  }
  if (action.type === "socket-lost") {
    // Keep identity display; input closes until the new snapshot arrives.
    return { ...state, join: { kind: "connecting" }, inputOpen: false, ratingCandidateLabel: null };
  }
  if (action.type === "session-ended") {
    return {
      ...initialPhoneState,
      join: { kind: "ended" },
    };
  }

  const m = action.message;
  switch (m.t) {
    case "identity":
      return { ...state, join: { kind: "accepted", identity: m }, sessionId: m.sessionId };
    case "join_rejected":
      return {
        ...state,
        join: {
          kind: "rejected",
          reason: m.reason,
          ...(m.retryAfterMs === undefined ? {} : { retryAfterMs: m.retryAfterMs }),
        },
      };
    case "snapshot":
    case "phase": {
      if (m.sessionId === state.sessionId && m.phaseEpoch < state.phaseEpoch) return state;
      const timedMedia = m.phase.kind === "video" || m.phase.kind === "video-position-question" ? m.phase : null;
      const receivedAtMs = action.receivedAtMs ?? m.serverTime;
      const phaseTiming: NonNullable<PhoneState["phaseTiming"]> = {
        startedAt: m.phase.startedAt,
        serverOffsetMs: m.serverTime - receivedAtMs,
        title: "title" in m.phase ? m.phase.title ?? null : null,
        subtitles: timedMedia?.subtitles ?? [],
        rating: timedMedia?.rating ?? null,
      };
      return {
        ...state,
        sessionId: m.sessionId,
        phaseEpoch: m.phaseEpoch,
        currentPhaseId: m.phase.id,
        inputOpen:
          m.phase.kind === "idle" ||
          m.phase.kind === "video" ||
          m.phase.kind === "position-question" ||
          m.phase.kind === "video-position-question",
        phaseTiming,
        ...temporalFields(phaseTiming, receivedAtMs),
      };
    }
    case "status":
      return { ...state, statusMessage: m.message };
    case "reload":
      return { ...state, reloadRequired: m };
    default:
      return state;
  }
}

function temporalFields(
  timing: NonNullable<PhoneState["phaseTiming"]>,
  clientNowMs: number,
): Pick<PhoneState, "ratingCandidateLabel" | "phoneDisplayText"> {
  const elapsedMs = clientNowMs + timing.serverOffsetMs - timing.startedAt;
  const activeSubtitles = timing.subtitles
    .filter((subtitle) => elapsedMs >= subtitle.startAtMs && elapsedMs < subtitle.endAtMs)
    .map((subtitle) => subtitle.text);
  const windows = timing.rating?.windows;
  const reactionsActive = timing.rating !== null
    && (windows === undefined || windows.some((window) => elapsedMs >= window.startAtMs && elapsedMs < window.endAtMs));
  return {
    ratingCandidateLabel: reactionsActive && timing.rating !== null ? timing.rating.candidateLabel : null,
    phoneDisplayText: activeSubtitles.length > 0 ? activeSubtitles.join("\n") : timing.title,
  };
}
