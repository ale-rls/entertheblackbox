import type {
  IdentityMessage,
  JoinRejectedMessage,
  ReloadMessage,
  ServerToClientMessage,
} from "@smartphonecracy/protocol";

/**
 * Phone state reducer. The phone intentionally renders almost nothing
 * (plan §10): it needs its identity marker, whether input is currently
 * accepted (position-question phases only), and join/connection status.
 */

export type JoinState =
  | { kind: "connecting" }
  | { kind: "joining" }
  | { kind: "accepted"; identity: IdentityMessage }
  | { kind: "ended" }
  | { kind: "rejected"; reason: JoinRejectedMessage["reason"]; retryAfterMs?: number };

export type PhoneState = {
  join: JoinState;
  sessionId: string | null;
  phaseEpoch: number;
  /** Input is only accepted during position questions (plan §10). */
  inputOpen: boolean;
  currentPhaseId: string | null;
  statusMessage: string | null;
  reloadRequired: ReloadMessage | null;
};

export const initialPhoneState: PhoneState = {
  join: { kind: "connecting" },
  sessionId: null,
  phaseEpoch: -1,
  inputOpen: false,
  currentPhaseId: null,
  statusMessage: null,
  reloadRequired: null,
};

export type PhoneAction =
  | { type: "server-message"; message: ServerToClientMessage }
  | { type: "socket-open" }
  | { type: "socket-lost" }
  | { type: "session-ended" };

export function phoneReducer(state: PhoneState, action: PhoneAction): PhoneState {
  if (action.type === "socket-open") {
    return { ...state, join: { kind: "joining" } };
  }
  if (action.type === "socket-lost") {
    // Keep identity display; input closes until the new snapshot arrives.
    return { ...state, join: { kind: "connecting" }, inputOpen: false };
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
      return {
        ...state,
        sessionId: m.sessionId,
        phaseEpoch: m.phaseEpoch,
        currentPhaseId: m.phase.id,
        inputOpen: m.phase.kind === "video" || m.phase.kind === "position-question",
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
