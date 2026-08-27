import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DisplayToServerMessage } from "@smartphonecracy/protocol";
import { CursorField } from "./cursors/cursorField.js";
import { CursorCanvas } from "./cursors/CursorCanvas.js";
import { RealtimeWsClient } from "./cursors/realtimeWsClient.js";
import { DisplayConnection } from "./lib/connection.js";
import { applyKioskGuards, performReload } from "./lib/kiosk.js";
import { IDLE_PLACEHOLDER, startHeartbeat } from "./lib/heartbeat.js";
import { startQrGrantRefresh } from "./qr/refreshGrant.js";
import { useMedia } from "./media/useMedia.js";
import { displayReducer, initialDisplayState } from "./state/store.js";
import { Countdown } from "./components/Countdown.js";
import { QrBadge } from "./components/QrBadge.js";
import { QuadrantOverlay } from "./components/QuadrantOverlay.js";
import { IdleAttract } from "./components/IdleAttract.js";
import { LobbyCountdown } from "./components/LobbyCountdown.js";
import { PhoneCount } from "./components/PhoneCount.js";
import { PhaseVideo } from "./components/PhaseVideo.js";
import { RatingMeter } from "./components/RatingMeter.js";
import { VideoQuestionOverlay } from "./components/VideoQuestionOverlay.js";

/**
 * Display application shell (plan §9), three rendering layers:
 *  1. video layer — one active <video> element
 *  2. UI layer — prompts, axes, countdowns, diagnostics
 *  3. cursor canvas — filled in by STEP-015
 * Media caching/Blob playback arrives in STEP-014; QR badge + heartbeat
 * loop are wired in by STEP-016. This shell renders phases from server
 * snapshots only.
 */

declare const __BUILD_VERSION__: string | undefined;
declare const __REALTIME_WS_URL__: string | undefined;
declare const __DISPLAY_TOKEN__: string | undefined;

const config = {
  url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  clientVersion:
    typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "0.0.0-dev",
  installationId:
    new URLSearchParams(location.search).get("installation") ?? "inst-1",
  roomId: new URLSearchParams(location.search).get("room") ?? "room-1",
  displayToken:
    new URLSearchParams(location.search).get("token")
      ?? (typeof __DISPLAY_TOKEN__ === "string" ? __DISPLAY_TOKEN__ : ""),
  realtimeWsUrl:
    typeof __REALTIME_WS_URL__ === "string" ? __REALTIME_WS_URL__ : "ws://localhost:9001",
};

export function App() {
  const [state, dispatch] = useReducer(displayReducer, initialDisplayState);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const stateRef = useRef(state);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  stateRef.current = state;

  const cursorField = useMemo(() => new CursorField(), []);

  const connection = useMemo(
    () =>
      new DisplayConnection({
        ...config,
        onMessage: (message) => {
          // Cursor batches bypass React state (20–30 Hz), everything
          // else flows through the reducer.
          if (message.t === "cursors") {
            cursorField.ingest(message, Date.now());
            return;
          }
          if (
            (message.t === "snapshot" || message.t === "phase") &&
            (message.phase.kind === "idle" ||
              message.sessionId !== stateRef.current.sessionId)
          ) {
            cursorField.clear();
          }
          dispatch({ type: "server-message", message });
        },
        onStatusChange: (status) => dispatch({ type: "connection-status", status }),
      }),
    [cursorField],
  );

  // Low-latency cursor overlay (apps/realtime-ws-coolify): additive to the main
  // connection's batched `cursors` messages above, gated by the same
  // idle-phase check so no cursors render on the attract loop.
  const realtimeWs = useMemo(
    () =>
      new RealtimeWsClient({
        url: config.realtimeWsUrl,
        room: `${config.installationId}:${config.roomId}`,
        onSnapshot: (cursors) => {
          const at = Date.now();
          for (const cursor of cursors) {
            cursorField.upsertOne(cursor.clientId, cursor.color, cursor.x, cursor.y, at);
          }
        },
        onUpdate: (cursor) => {
          cursorField.upsertOne(cursor.clientId, cursor.color, cursor.x, cursor.y, Date.now());
        },
        onLeave: (clientId) => cursorField.removeOne(clientId),
      }),
    [cursorField],
  );

  useEffect(() => {
    realtimeWs.start();
    return () => realtimeWs.stop();
  }, [realtimeWs]);

  useEffect(() => applyKioskGuards(), []);

  useEffect(() => {
    if (state.reloadRequired) void performReload();
  }, [state.reloadRequired]);

  // display_heartbeat loop (plan §7): read from a ref so every tick sees
  // the latest session/phase, not a stale closure over the mount-time
  // state. "idle" matches the server's idle-session convention
  // (apps/server/src/engine/phase-engine.ts) and satisfies the schema's
  // nonEmpty sessionId/phaseId before the first snapshot arrives.
  useEffect(() => {
    const dispose = startHeartbeat({
      isOpen: () => connection.currentStatus === "open",
      getState: () => ({
        sessionId: stateRef.current.sessionId ?? IDLE_PLACEHOLDER,
        phaseId: stateRef.current.phase?.id ?? IDLE_PLACEHOLDER,
        phaseEpoch: Math.max(0, stateRef.current.phaseEpoch),
      }),
      send: (message) => connection.send(message),
    });
    return dispose;
  }, [connection]);

  // QR grants expire 2 minutes after being issued and the server only
  // ever issues one on its own (at display_join) -- without this, any
  // display connection older than that shows an already-expired or
  // already-hidden code for the rest of its lifetime (see refreshGrant.ts).
  useEffect(() => {
    const dispose = startQrGrantRefresh({
      isOpen: () => connection.currentStatus === "open",
      send: (message) => connection.send(message),
    });
    return dispose;
  }, [connection]);

  // Freeze follows the reducer's session/epoch-gated resolution state,
  // so a stale question_resolved frame can never freeze a live field
  // (codex review finding). Phase advance clears resolution → unfreeze.
  useEffect(() => {
    const update = () => {
      const activePhase = stateRef.current.phase;
      const resolution = stateRef.current.resolution;
      if (resolution === null) {
        cursorField.setFrozen(false);
        return;
      }
      if (activePhase?.kind === "video-position-question") {
        cursorField.setFrozen(connection.clock.now() < activePhase.startedAt + activePhase.hideAtMs);
        return;
      }
      cursorField.setFrozen(true);
    };
    update();
    const timer = state.resolution !== null ? setInterval(update, 100) : null;
    return () => {
      if (timer !== null) clearInterval(timer);
    };
  }, [connection.clock, cursorField, state.resolution]);

  const media = useMedia();
  const phase = state.phase;
  const isIdle = phase === null || phase.kind === "idle";
  const mediaReady = media.status.state === "ready";

  // Do not authenticate the installation display until every manifest
  // entry is available and verified. Until then the local idle attract
  // loop and preparation status remain usable, but the server cannot
  // expose a join grant or admit visitors into an unprepared show.
  useEffect(() => {
    if (!mediaReady) return;
    connection.start();
    return () => connection.stop();
  }, [connection, mediaReady]);

  const sendDisplayMessage = useCallback(
    (message: DisplayToServerMessage) => connection.send(message),
    [connection],
  );
  const setActiveVideo = useCallback((video: HTMLVideoElement | null) => {
    activeVideoRef.current = video;
  }, []);
  const toggleSound = useCallback(() => {
    const enable = !soundEnabled;
    if (enable && activeVideoRef.current !== null) {
      // Keep this play() call inside the click handler: browsers require an
      // explicit user gesture before they allow audible media playback.
      activeVideoRef.current.muted = false;
      const play = activeVideoRef.current.play();
      void play?.catch((error: unknown) => {
        console.warn("display: failed to enable audible playback:", error);
      });
    }
    setSoundEnabled(enable);
  }, [soundEnabled]);

  // Keep the Blob URL set aligned with the active phase (plan §9);
  // preloading plausible next videos needs the id→src map from STEP-026.
  useEffect(() => {
    void media.showVideo(
      phase?.kind === "video" || phase?.kind === "video-position-question"
        ? phase.src
        : null,
    );
  }, [phase?.kind === "video" || phase?.kind === "video-position-question" ? phase.src : null]);

  return (
    <main className="display-root">
      {/* Layer 1: video */}
      <section className="layer layer-video">
        {isIdle && (
          <IdleAttract
            grant={state.qrGrant}
            qrHidden={state.qrHidden}
            clock={connection.clock}
          />
        )}
        {(phase?.kind === "video" || phase?.kind === "video-position-question") && media.videoUrl !== null && (
          <PhaseVideo
            key={phase.id}
            sessionId={state.sessionId}
            phase={phase}
            phaseEpoch={state.phaseEpoch}
            src={media.videoUrl}
            soundEnabled={soundEnabled}
            onVideoElement={setActiveVideo}
            send={sendDisplayMessage}
          />
        )}
      </section>

      {/* Layer 2: UI */}
      <section className="layer layer-ui">
        <button
          type="button"
          className="sound-control"
          aria-pressed={soundEnabled}
          onClick={toggleSound}
        >
          {soundEnabled ? "Mute sound" : "Enable sound"}
        </button>
        {mediaReady && state.connection !== "open" && (
          <div className="reconnecting">reconnecting…</div>
        )}
        {!mediaReady && (
          <div className="media-status">
            {media.status.state === "retrying"
              ? `media sync retrying (attempt ${media.status.attempt}): ${media.status.lastError}`
              : "preparing media…"}
          </div>
        )}
        {!isIdle && (
          <QrBadge grant={state.qrGrant} qrHidden={state.qrHidden} clock={connection.clock} />
        )}
        <LobbyCountdown
          sessionId={state.sessionId}
          phase={phase}
          clock={connection.clock}
        />
        {phase?.kind === "position-question" && (
          <div className="question">
            <div className="question-copy">
              {phase.title && <h2>{phase.title}</h2>}
              <p className="question-text">{phase.text}</p>
            </div>
            <QuadrantOverlay
              field={phase.field}
              liveField={state.liveField}
              liveCounts={state.liveCounts}
              resolution={state.resolution}
            />
            {state.resolution === null && phase.deadlineAt !== null && (
              <Countdown clock={connection.clock} deadlineAt={phase.deadlineAt} />
            )}
          </div>
        )}
        {phase?.kind === "video" && phase.title && (
          <div className="video-title">{phase.title}</div>
        )}
        {phase?.kind === "video-position-question" && (
          <VideoQuestionOverlay
            phase={phase}
            clock={connection.clock}
            liveField={state.liveField}
            liveCounts={state.liveCounts}
            resolution={state.resolution}
          />
        )}
        {phase?.kind === "video" && phase.rating && <RatingMeter status={state.ratingStatus} />}
        {state.notice && (
          <div
            className={[
              "notice",
              `notice-${state.notice.level}`,
              // display_replaced means another kiosk took over this
              // connection (plan §7) — the operator needs to notice at a
              // glance, so it gets a dedicated prominent treatment.
              state.notice.code === "display_replaced" ? "notice-prominent" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {state.notice.message}
          </div>
        )}
        {isIdle && <PhoneCount count={state.presenceCount} />}
      </section>

      {/* Layer 3: cursor canvas */}
      <section className="layer layer-cursors">
        <CursorCanvas field={cursorField} showCursors={phase !== null && phase.kind !== "idle" ? (phase.showCursors ?? true) : true} />
      </section>
    </main>
  );
}
