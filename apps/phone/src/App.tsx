import { useEffect, useMemo, useReducer, useRef } from "react";
import { PROTOCOL_VERSION } from "@smartphonecracy/protocol";
import { PhoneConnection } from "./lib/connection.js";
import { RealtimeCursorPublisher } from "./lib/realtimeWsClient.js";
import {
  applyDelta,
  InputThrottle,
  TRACKPAD_CENTER,
  type TrackpadState,
} from "./lib/trackpad.js";
import { initialPhoneState, phoneReducer } from "./state/store.js";

/**
 * Phone controller (plan §10): fullscreen relative trackpad, small
 * identity marker, minimal connection indicator. No names, no accounts.
 * The phone never mirrors the question/countdown — participants look up
 * at the projection.
 */

declare const __BUILD_VERSION__: string | undefined;
declare const __REALTIME_WS_URL__: string | undefined;

const params = new URLSearchParams(location.search);
const config = {
  url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  clientVersion:
    typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "0.0.0-dev",
  installationId: params.get("installation") ?? "inst-1",
  roomId: params.get("room") ?? "room-1",
  joinGrant: params.get("g") ?? "",
  realtimeWsUrl:
    typeof __REALTIME_WS_URL__ === "string" ? __REALTIME_WS_URL__ : "ws://localhost:9001",
};

const REJECTION_TEXT: Record<string, string> = {
  expired_grant: "This code has expired — scan the QR on the screen again.",
  room_full: "The room is full right now. Watch the screen and try again soon.",
  rate_limited: "Too many attempts — wait a moment and scan again.",
  show_in_progress: "The show is in progress — wait for the next round.",
};

export function App() {
  const [state, dispatch] = useReducer(phoneReducer, initialPhoneState);
  const identity = state.join.kind === "accepted" ? state.join.identity : null;
  const position = useRef<TrackpadState>({ ...TRACKPAD_CENTER });
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const seq = useRef(0);
  const throttle = useMemo(() => new InputThrottle(), []);
  const realtimeWs = useRef<RealtimeCursorPublisher | null>(null);

  const connection = useMemo(
    () =>
      new PhoneConnection({
        ...config,
        onMessage: (message) => dispatch({ type: "server-message", message }),
        onSocketOpen: () => dispatch({ type: "socket-open" }),
        onSocketLost: () => dispatch({ type: "socket-lost" }),
        onSessionEnded: () => {
          const url = new URL(location.href);
          url.searchParams.delete("g");
          history.replaceState(null, "", url);
          dispatch({ type: "session-ended" });
        },
      }),
    [],
  );

  useEffect(() => {
    connection.start();
    return () => connection.stop();
  }, [connection]);

  // Low-latency cursor overlay (apps/realtime-ws-coolify): additive to the "input"
  // message sent over the main connection above, published once this
  // phone's server-assigned identity (clientId + color) is known so the
  // display renders it with the same color everywhere.
  useEffect(() => {
    if (identity === null) return;
    const publisher = new RealtimeCursorPublisher({
      url: config.realtimeWsUrl,
      room: `${config.installationId}:${config.roomId}`,
      clientId: identity.clientId,
      color: identity.color,
    });
    realtimeWs.current = publisher;
    publisher.start();
    return () => {
      publisher.stop();
      realtimeWs.current = null;
    };
  }, [identity?.clientId, identity?.color]);

  useEffect(() => {
    if (state.reloadRequired) {
      void (async () => {
        try {
          const regs = await navigator.serviceWorker?.getRegistrations();
          await Promise.allSettled((regs ?? []).map((r) => r.update()));
        } catch {
          // reload regardless
        }
        location.reload();
      })();
    }
  }, [state.reloadRequired]);

  const sendPosition = (delivery: "move" | "final" = "move") => {
    if (!state.inputOpen || state.sessionId === null) return;
    const now = Date.now();
    const shouldSend =
      delivery === "final"
        ? throttle.shouldFlushFinal(now)
        : throttle.shouldSend(now);
    if (!shouldSend) return;
    realtimeWs.current?.send(position.current.x, position.current.y);
    connection.send({
      t: "input",
      v: PROTOCOL_VERSION,
      sessionId: state.sessionId,
      phaseEpoch: state.phaseEpoch,
      seq: seq.current++,
      x: position.current.x,
      y: position.current.y,
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPointer.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const last = lastPointer.current;
    if (last === null) return;
    const surface = Math.min(window.innerWidth, window.innerHeight);
    position.current = applyDelta(
      position.current,
      e.clientX - last.x,
      e.clientY - last.y,
      surface,
    );
    lastPointer.current = { x: e.clientX, y: e.clientY };
    sendPosition();
  };

  const onPointerEnd = () => {
    lastPointer.current = null;
    sendPosition("final");
  };

  const sendReaction = (kind: "applause" | "boo") => {
    if (state.sessionId === null) return;
    connection.send({
      t: "reaction",
      v: PROTOCOL_VERSION,
      sessionId: state.sessionId,
      phaseEpoch: state.phaseEpoch,
      kind,
    });
  };

  return (
    <main
      className="phone-root"
      style={{ touchAction: "none", userSelect: "none" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.join.kind === "ended" ? (
        <div className="rejected">
          <p>The show has ended — scan the QR on the screen to join again.</p>
        </div>
      ) : state.join.kind === "rejected" ? (
        <div className="rejected">
          <p>{REJECTION_TEXT[state.join.reason] ?? "Could not join."}</p>
        </div>
      ) : (
        <div
          className="trackpad"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {!state.inputOpen && (
            <p className="watch-screen">Watch the screen</p>
          )}
          {state.ratingCandidateLabel !== null && (
            <div className="rating-buttons" aria-label={`Reactions for ${state.ratingCandidateLabel}`}>
              <button
                type="button"
                className="rating-button applause"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  sendReaction("applause");
                }}
                aria-label={`Applaud ${state.ratingCandidateLabel}`}
              >
                👏
              </button>
              <button
                type="button"
                className="rating-button boo"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  sendReaction("boo");
                }}
                aria-label={`Boo ${state.ratingCandidateLabel}`}
              >
                👎
              </button>
            </div>
          )}
        </div>
      )}

      <footer className="hud">
        {identity && (
          <span
            className="identity-marker"
            style={{ backgroundColor: identity.color }}
            title={identity.clientId}
          />
        )}
        <span
          className={`connection-dot ${state.join.kind === "accepted" ? "online" : "offline"}`}
        />
      </footer>
    </main>
  );
}
