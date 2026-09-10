import {
  PROTOCOL_VERSION,
  type DisplayHeartbeatMessage,
  type DisplayToServerMessage,
} from "@entertheblackbox/protocol";

/**
 * display_heartbeat loop (plan §7): tells the server this display is
 * still alive for the session/phase it last observed, so the server can
 * clear `displayDisconnectedAt` and avoid aborting to idle on a brief
 * hiccup. The server's idle-session convention (apps/server phase-engine)
 * uses the literal string "idle" for both `sessionId` and `phaseId` while
 * no session/phase has started, which also satisfies the protocol's
 * nonEmpty-string requirement before the display has received its first
 * snapshot.
 */

export const IDLE_PLACEHOLDER = "idle";
const DEFAULT_INTERVAL_MS = 5000;

export type HeartbeatState = {
  sessionId: string;
  phaseId: string;
  phaseEpoch: number;
};

export type HeartbeatOptions = {
  /** Whether the socket is currently open; heartbeats are skipped otherwise. */
  isOpen: () => boolean;
  /** Read the latest known session/phase — called fresh on every tick. */
  getState: () => HeartbeatState;
  send: (message: DisplayToServerMessage) => void;
  intervalMs?: number;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

/**
 * Starts the 5 s heartbeat loop. Returns a dispose function that stops
 * the timer; call it when the display connection is torn down.
 */
export function startHeartbeat(options: HeartbeatOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const schedule = options.setIntervalFn ?? setInterval;
  const cancel = options.clearIntervalFn ?? clearInterval;

  const tick = () => {
    if (!options.isOpen()) return;
    const state = options.getState();
    const message: DisplayHeartbeatMessage = {
      t: "display_heartbeat",
      v: PROTOCOL_VERSION,
      sessionId: state.sessionId,
      phaseId: state.phaseId,
      phaseEpoch: state.phaseEpoch,
      clientTime: now(),
    };
    options.send(message);
  };

  const timer = schedule(tick, intervalMs);
  return () => cancel(timer);
}
