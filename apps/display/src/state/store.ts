import type {
  PhaseSnapshotMessage,
  QrGrantMessage,
  QuestionResolvedMessage,
  QuestionStatusMessage,
  RatingStatusMessage,
  ReloadMessage,
  ServerToClientMessage,
} from "@smartphonecracy/protocol";
import type { ConnectionStatus } from "../lib/connection.js";

/**
 * Display state as a pure reducer over server messages (plan §9:
 * "Receive a phase snapshot and render from server timestamps").
 * Keeping this pure makes phase/reconnect behavior unit-testable
 * without a browser or socket.
 */

export type DisplayState = {
  connection: ConnectionStatus;
  sessionId: string | null;
  phaseEpoch: number;
  phase: PhaseSnapshotMessage | null;
  presenceCount: number;
  qrGrant: QrGrantMessage | null;
  qrHidden: boolean;
  notice: { code: string; level: string; message: string } | null;
  reloadRequired: ReloadMessage | null;
  /** Present only while the server sends showLiveCounts questions (plan §7). */
  liveCounts: NonNullable<QuestionStatusMessage["quadrantCounts"]> | null;
  /** Field discriminator paired with liveCounts by the protocol. */
  liveField: QuestionStatusMessage["field"] | null;
  /** Set by question_resolved; cleared when the next phase arrives. */
  resolution: QuestionResolvedMessage | null;
  /** Live applause/boo tally for the current rating-enabled video phase, if any. */
  ratingStatus: RatingStatusMessage | null;
};

export const initialDisplayState: DisplayState = {
  connection: "closed",
  sessionId: null,
  phaseEpoch: -1,
  phase: null,
  presenceCount: 0,
  qrGrant: null,
  qrHidden: false,
  notice: null,
  reloadRequired: null,
  liveCounts: null,
  liveField: null,
  resolution: null,
  ratingStatus: null,
};

export type DisplayAction =
  | { type: "server-message"; message: ServerToClientMessage }
  | { type: "connection-status"; status: ConnectionStatus };

export function displayReducer(
  state: DisplayState,
  action: DisplayAction,
): DisplayState {
  if (action.type === "connection-status") {
    // On any disconnect the last QR grant is untrustworthy; the server
    // resends one after display_join.
    if (action.status === "reconnecting") {
      return { ...state, connection: action.status, qrGrant: null };
    }
    return { ...state, connection: action.status };
  }

  const m = action.message;
  switch (m.t) {
    case "snapshot":
    case "phase": {
      // Stale-epoch guard: a delayed frame from a previous phase must not
      // regress the display (plan §16). Epochs reset with new sessions.
      if (m.sessionId === state.sessionId && m.phaseEpoch < state.phaseEpoch) {
        return state;
      }
      return {
        ...state,
        sessionId: m.sessionId,
        phaseEpoch: m.phaseEpoch,
        phase: m.phase,
        notice: null,
        liveCounts: null,
        liveField: null,
        resolution: null,
        ratingStatus: null,
      };
    }
    case "presence":
      return { ...state, presenceCount: m.count };
    case "question_status":
      if (m.sessionId !== state.sessionId || m.phaseEpoch !== state.phaseEpoch) {
        return state; // stale question frame
      }
      return {
        ...state,
        liveCounts: m.quadrantCounts ?? null,
        liveField: m.quadrantCounts === undefined ? null : m.field,
      };
    case "question_resolved":
      if (m.sessionId !== state.sessionId || m.phaseEpoch !== state.phaseEpoch) {
        return state;
      }
      return { ...state, resolution: m };
    case "rating_status":
      if (m.sessionId !== state.sessionId || m.phaseEpoch !== state.phaseEpoch) {
        return state; // stale rating frame
      }
      return { ...state, ratingStatus: m };
    case "qr_grant":
      return { ...state, qrGrant: m, qrHidden: false };
    case "qr_hidden":
      return { ...state, qrGrant: null, qrHidden: true };
    case "display_notice":
      return { ...state, notice: { code: m.code, level: m.level, message: m.message } };
    case "reload":
      return { ...state, reloadRequired: m };
    // Cursor batches go straight to the CursorField (never through
    // React state — 20–30 Hz would thrash the tree).
    case "cursors":
    case "identity":
    case "join_rejected":
    case "status":
    case "pong":
      return state;
  }
}
