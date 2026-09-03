import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DisplayToServerMessage } from "@smartphonecracy/protocol";
import { CursorField } from "./cursors/cursorField.js";
import { CursorCanvas } from "./cursors/CursorCanvas.js";
import { SpectrumGlowCanvas } from "./cursors/SpectrumGlowCanvas.js";
import { RealtimeWsClient } from "./cursors/realtimeWsClient.js";
import { DisplayConnection } from "./lib/connection.js";
import { applyKioskGuards, performReload } from "./lib/kiosk.js";
import { IDLE_PLACEHOLDER, startHeartbeat } from "./lib/heartbeat.js";
import { startQrGrantRefresh } from "./qr/refreshGrant.js";
import { useMedia } from "./media/useMedia.js";
import { displayReducer, initialDisplayState } from "./state/store.js";
import { Countdown } from "./components/Countdown.js";
import { QrBadge } from "./components/QrBadge.js";
import { QuadrantOverlay, questionFieldCenter } from "./components/QuadrantOverlay.js";
import { IdleAttract } from "./components/IdleAttract.js";
import { LobbyCountdown } from "./components/LobbyCountdown.js";
import { PhaseVideoHandoff, type PhaseVideoCandidate } from "./components/PhaseVideoHandoff.js";
import { PhaseImageAudio } from "./components/PhaseImageAudio.js";
import { CrowdReactionSounds } from "./components/CrowdReactionSounds.js";
import { VideoQuestionOverlay } from "./components/VideoQuestionOverlay.js";
import { PhaseSubtitles } from "./components/PhaseSubtitles.js";
import { FullscreenControl } from "./components/FullscreenControl.js";
import { VoteDecisionSound } from "./components/VoteDecisionSound.js";

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
declare const __LOBBY_WIFI_NAME__: string | undefined;

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
  const [presentedVideoKey, setPresentedVideoKey] = useState<string | null>(null);
  const stateRef = useRef(state);
  const activeMediaRef = useRef<HTMLMediaElement | null>(null);
  const activeExtraAudioRef = useRef<HTMLAudioElement | null>(null);
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
  const setActiveMedia = useCallback((mediaElement: HTMLMediaElement | null) => {
    activeMediaRef.current = mediaElement;
  }, []);
  const setActiveExtraAudio = useCallback((audioElement: HTMLAudioElement | null) => {
    activeExtraAudioRef.current = audioElement;
  }, []);
  const enableSound = useCallback(() => {
    for (const mediaElement of [activeMediaRef.current, activeExtraAudioRef.current]) {
      if (mediaElement === null) continue;
      // Keep this play() call inside the click handler: browsers require an
      // explicit user gesture before they allow audible media playback.
      mediaElement.muted = false;
      const play = mediaElement.play();
      void play?.catch((error: unknown) => {
        console.warn("display: failed to enable audible playback:", error);
      });
    }
    setSoundEnabled(true);
  }, []);

  // Keep the Blob URL set aligned with the active phase (plan §9);
  // preloading plausible next videos needs the id→src map from STEP-026.
  const phaseVisualSrc = phase?.kind === "video" || phase?.kind === "video-position-question" ? phase.src : null;
  const phaseAudioSrc = phase?.kind === "video" || phase?.kind === "video-position-question" ? phase.audioSrc ?? null : null;
  const phaseExtraAudioSrc = phase?.kind === "video" || phase?.kind === "video-position-question" ? phase.extraAudioSrc ?? null : null;
  const spectrumPhase = phase?.kind === "position-question" || phase?.kind === "video-position-question"
    ? phase
    : null;
  const phaseVideoKey = (phase?.kind === "video" || phase?.kind === "video-position-question")
    && phase.audioSrc === undefined
    ? `${state.sessionId ?? "pending"}:${state.phaseEpoch}`
    : null;
  const phaseVideoCandidate: PhaseVideoCandidate | null = phaseVideoKey !== null
    && (phase?.kind === "video" || phase?.kind === "video-position-question")
    && phase.audioSrc === undefined
    && media.visualSrc === phase.src
    && media.videoUrl !== null
    ? {
        key: phaseVideoKey,
        sessionId: state.sessionId,
        phase,
        phaseEpoch: state.phaseEpoch,
        src: media.videoUrl,
        ...(media.extraAudioUrl === null ? {} : { extraAudioSrc: media.extraAudioUrl }),
      }
    : null;
  // Keep the already-decoded attract player mounted for the lifetime of the
  // app. It stays visible beneath an outgoing phase frame until an incoming
  // phase video is presented, and stays paused/hidden during the show. This
  // also gives video -> idle transitions an immediately available frame.
  const idleMediaVisible = isIdle
    || (phaseVideoKey !== null && presentedVideoKey !== phaseVideoKey);
  useEffect(() => {
    void media.showMedia(phaseVisualSrc, phaseAudioSrc, phaseExtraAudioSrc);
  }, [phaseVisualSrc, phaseAudioSrc, phaseExtraAudioSrc]);

  return (
    <main className="display-root">
      {/* Layer 1: video */}
      <section className="layer layer-video">
        <IdleAttract
          grant={state.qrGrant}
          qrHidden={state.qrHidden}
          clock={connection.clock}
          mediaVisible={idleMediaVisible}
        />
        <PhaseVideoHandoff
          desiredKey={phaseVideoKey}
          candidate={phaseVideoCandidate}
          soundEnabled={soundEnabled}
          onVideoElement={setActiveMedia}
          onExtraAudioElement={setActiveExtraAudio}
          onActiveKey={setPresentedVideoKey}
          send={sendDisplayMessage}
        />
        {(phase?.kind === "video" || phase?.kind === "video-position-question") && phase.audioSrc !== undefined && media.visualSrc === phase.src && media.videoUrl !== null && media.audioUrl !== null && (
          <PhaseImageAudio
            key={phase.id}
            sessionId={state.sessionId}
            phase={phase as typeof phase & { audioSrc: string }}
            phaseEpoch={state.phaseEpoch}
            imageSrc={media.videoUrl}
            audioSrc={media.audioUrl}
            soundEnabled={soundEnabled}
            onAudioElement={setActiveMedia}
            send={sendDisplayMessage}
          />
        )}
      </section>

      {/* Density-driven spectrum bloom, above media but beneath crisp UI. */}
      {spectrumPhase !== null && (spectrumPhase.spectrumGlow ?? true) && <section className="layer layer-spectrum-glow">
        <SpectrumGlowCanvas
          cursorField={cursorField}
          field={spectrumPhase.field}
          clock={connection.clock}
          {...(spectrumPhase.kind === "video-position-question" ? {
            visibleFrom: spectrumPhase.startedAt + spectrumPhase.showAtMs,
            visibleUntil: spectrumPhase.startedAt + spectrumPhase.hideAtMs,
          } : {})}
        />
      </section>}

      {/* Layer 2: UI */}
      <section className="layer layer-ui">
        <div className="display-controls">
          {!soundEnabled && <button
            type="button"
            className="sound-control"
            onClick={enableSound}
          >
            Enable sound
          </button>}
          <FullscreenControl />
        </div>
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
        {/* Plain statement videos (e.g. the host's greeting) don't need a
            join code on screen -- the QR only matters once there's
            something to vote on. */}
        {!isIdle && phase?.kind !== "video" && (
          <QrBadge grant={state.qrGrant} qrHidden={state.qrHidden} clock={connection.clock} />
        )}
        <LobbyCountdown
          sessionId={state.sessionId}
          phase={phase}
          clock={connection.clock}
          joinUrl={state.qrGrant?.showJoinUrl === false ? null : state.qrGrant?.url ?? null}
          networkName={typeof __LOBBY_WIFI_NAME__ === "string" ? __LOBBY_WIFI_NAME__ : "[Netzname]"}
        />
        {phase?.kind === "position-question" && (
          <div className="question">
            <div className="question-copy">
              <p className="question-text">{phase.text}</p>
            </div>
            <QuadrantOverlay
              field={phase.field}
              liveField={state.liveField}
              liveCounts={state.liveCounts}
              resolution={state.resolution}
            />
            {state.resolution === null && phase.deadlineAt !== null && (
              <Countdown clock={connection.clock} deadlineAt={phase.deadlineAt} center={questionFieldCenter(phase.field)} />
            )}
          </div>
        )}
        {phase?.kind === "video" && phase.title && (
          <div className="video-title">{phase.title}</div>
        )}
        {(phase?.kind === "video" || phase?.kind === "video-position-question") && <PhaseSubtitles phase={phase} clock={connection.clock} />}
        {phase?.kind === "video-position-question" && (
          <VideoQuestionOverlay
            phase={phase}
            clock={connection.clock}
            liveField={state.liveField}
            liveCounts={state.liveCounts}
            resolution={state.resolution}
            soundEnabled={soundEnabled}
          />
        )}
        {(phase?.kind === "video" || phase?.kind === "video-position-question") && phase.rating && (
          <CrowdReactionSounds status={state.ratingStatus} soundEnabled={soundEnabled} {...(phase.rating.windows === undefined ? {} : { windows: phase.rating.windows })} elapsedMs={connection.clock.now() - phase.startedAt} />
        )}
        <VoteDecisionSound resolution={state.resolution} soundEnabled={soundEnabled} />
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
      </section>

      {/* Layer 3: cursor canvas */}
      <section className="layer layer-cursors">
        <CursorCanvas field={cursorField} showCursors={phase !== null && phase.kind !== "idle" ? (phase.showCursors ?? true) : true} blinkActiveVoters={state.resolution !== null} />
      </section>
    </main>
  );
}
