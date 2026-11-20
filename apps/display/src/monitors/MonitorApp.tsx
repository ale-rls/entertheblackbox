import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { activeMonitorCue, monitorMediaSources, type MonitorCue, type MonitorId } from "@entertheblackbox/scenario";
import { rehearsalId, runtimeWebSocket } from "@entertheblackbox/protocol";
import type { ServerClock } from "@entertheblackbox/shared";
import { DisplayConnection } from "../lib/connection.js";
import { currentInstallation } from "../lib/resolveInstallation.js";
import { displayReducer, initialDisplayState } from "../state/store.js";
import { useMedia } from "../media/useMedia.js";
import { FullscreenControl } from "../components/FullscreenControl.js";
import { performReload } from "../lib/kiosk.js";
import { isAdjacentMonitorVideoCut, MONITOR_CUT_HOLD_MS, monitorCueReady, monitorVideoTime } from "./playback.js";
import { shownMonitorCountdown } from "./countdown.js";
import { monitorTextColor } from "./answerColor.js";
import { withoutWidows } from "./typography.js";
import { monitorVoteResult } from "./voteResult.js";
import "./monitors.css";

declare const __BUILD_VERSION__: string | undefined;
declare const __DISPLAY_TOKEN__: string | undefined;

type MonitorVideoCue = {
  key: string;
  scene: string;
  cue: Extract<MonitorCue, { kind: "video" }>;
  url: string;
  startedAt: number;
};

export function MonitorApp({ monitorId }: { monitorId: MonitorId }) {
  const [state, dispatch] = useReducer(displayReducer, initialDisplayState);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [presented, setPresented] = useState<MonitorVideoCue | null>(null);
  const setup = new URLSearchParams(location.search).get("setup") === "1";
  const connection = useMemo(() => new DisplayConnection({
    url: runtimeWebSocket(location), ...currentInstallation(), monitorId,
    displayToken: rehearsalId() ?? (typeof __DISPLAY_TOKEN__ === "string" ? __DISPLAY_TOKEN__ : ""),
    clientVersion: typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "0.0.0-dev",
    onMessage: (message) => dispatch({ type: "server-message", message }),
    onStatusChange: (status) => dispatch({ type: "connection-status", status }),
  }), [monitorId]);
  // Only this monitor’s current scene media is downloaded and verified.
  // A changed scenario revision revalidates the manifest and clears old URLs.
  const mediaRevision = rehearsalId() ? state.sessionId ?? "" : state.phase?.scenarioVersion ?? "";
  const sources = monitorMediaSources({ [monitorId]: state.phase?.monitorCues?.[monitorId] ?? [] });
  const sourceKey = JSON.stringify([...sources].sort());
  const media = useMedia(undefined, mediaRevision, { cacheName: `monitor-media-${monitorId}`, sources });
  useEffect(() => {
    connection.start();
    const timer = setInterval(() => setNow(connection.clock.now()), 33);
    return () => { clearInterval(timer); connection.stop(); };
  }, [connection]);
  useEffect(() => { if (state.reloadRequired) void performReload(); }, [state.reloadRequired]);
  const phase = state.phase;
  const cues = phase?.monitorCues?.[monitorId] ?? [];
  const elapsed = now - (phase?.startedAt ?? 0);
  const cue = phase && connection.clock.ready ? activeMonitorCue(cues, elapsed) : null;
  const src = cue && "src" in cue ? cue.src : null;
  const url = media.visualSrc === src ? media.videoUrl : null;
  const ready = media.status.state === "ready";
  const cueReady = monitorCueReady(cue, ready);
  const scene = JSON.stringify([monitorId, state.sessionId, state.phaseEpoch, phase?.startedAt, mediaRevision, sourceKey]);
  const key = JSON.stringify([scene, cue?.startMs, src]);
  const current: MonitorVideoCue | null = ready && cue?.kind === "video" && url && phase
    ? { key, scene, cue, url, startedAt: phase.startedAt + cue.startMs }
    : null;
  const outgoing = ready && !error && presented?.scene === scene && presented.key !== key &&
    isAdjacentMonitorVideoCut(cues, presented.cue.startMs, cue, elapsed) ? presented : null;
  const activeVideo = useRef<string | null>(null);
  useLayoutEffect(() => {
    activeVideo.current = current?.key ?? null;
  }, [current?.key]);
  useLayoutEffect(() => {
    // Protect the paused outgoing element before showMedia drops the prior source.
    if (outgoing) media.store.holdUrl(outgoing.url, MONITOR_CUT_HOLD_MS);
  }, [outgoing, media.store]);
  useEffect(() => {
    setError("");
    void media.showMedia(src).catch((cause) => setError(String(cause)));
  }, [src, state.sessionId, state.phaseEpoch, mediaRevision, sourceKey]);
  // An authored per-cue countdown keeps its own length; vote and scene
  // countdowns only show their final seconds. Either replaces the cue's text.
  const countdown = cueReady && connection.clock.ready
    ? shownMonitorCountdown(cues, phase, now, state.resolution !== null)
    : null;
  const voteResult = cue?.kind === "vote-result" ? monitorVoteResult(cue, phase) : null;
  const cueText = voteResult ? voteResult.text : cue?.kind === "text" || cue?.kind === "placeholder" ? cue.text : "";
  const countdownText = countdown !== null && <div className="monitor-text monitor-countdown-frame">
    <div className="monitor-countdown" aria-label="Seconds remaining">{countdown}</div>
    {cue?.countdownShowsText && cueText && <div className="monitor-countdown-question">{withoutWidows(cueText)}</div>}
  </div>;
  const answerColor = monitorTextColor(cue, voteResult?.color ?? null, phase, monitorId);
  const accent = answerColor ? { "--monitor-accent": answerColor } as CSSProperties : undefined;
  return <main className="monitor-root" aria-label={`Monitor ${monitorId}`} style={accent}>
    {countdownText}
    {countdown === null && voteResult && <div className="monitor-text">{withoutWidows(voteResult.text)}</div>}
    {countdown === null && cueReady && cue?.kind === "text" && <div className="monitor-text">{withoutWidows(cue.text)}</div>}
    {countdown === null && cueReady && cue?.kind === "placeholder" && <div className="monitor-placeholder"><small>{monitorId} · PLACEHOLDER</small><div>{withoutWidows(cue.text)}</div></div>}
    {ready && cue?.kind === "image" && url && <figure className="monitor-image"><img src={url} alt={cue.text ?? ""} style={{ objectFit: cue.fit }} onError={() => setError("Image could not be decoded")} />{cue.text && <figcaption>{withoutWidows(cue.text)}</figcaption>}</figure>}
    {[outgoing, current].map((video) => video && <MonitorVideo key={video.key} src={video.url} startedAt={video.startedAt}
      loop={video.cue.loop} fit={video.cue.fit} clock={connection.clock} active={video === current}
      hidden={video === current && outgoing !== null} onError={setError}
      onFrame={() => { if (activeVideo.current === video.key) setPresented(video); }} />)}
    {(!ready || setup || state.connection !== "open" || error || state.notice) && <aside className="monitor-status" role="status">
      <strong>{monitorId}</strong> · {state.connection} · {media.status.state}{ready ? " — media verified" : " — preparing media"}
      <p>Server clock: {connection.clock.ready ? "synchronized" : "synchronizing"} · scene media: {sources.length} files</p>
      {media.status.state === "downloading" && <p>{media.status.done}/{media.status.total}: {media.status.current}</p>}
      {media.status.state === "retrying" && <p>{media.status.lastError} — retrying</p>}
      {phase && <p>{phase.id} · {Math.max(0, Math.floor((now - phase.startedAt) / 1000))}s</p>}
      {state.connection !== "open" && <p>Waiting for server cues. The last received cue stays on its original clock.</p>}
      {(error || state.notice) && <p role="alert">{error || state.notice?.message}</p>}
    </aside>}
    <div className="display-controls"><FullscreenControl /></div>
  </main>;
}

function MonitorVideo({ src, startedAt, loop, fit, clock, active, hidden, onError, onFrame }: {
  src: string; startedAt: number; loop: boolean; fit: "contain" | "cover"; clock: ServerClock;
  active: boolean; hidden: boolean; onError: (message: string) => void; onFrame: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const frameCallback = useRef(onFrame);
  useLayoutEffect(() => { frameCallback.current = onFrame; }, [onFrame]);
  useEffect(() => {
    const video = ref.current;
    if (!video || !active) return;
    let pending = false;
    let disposed = false;
    let retryAt = 0;
    let reportedFrame = false;
    const update = () => {
      if (video.readyState < 1 || !clock.ready) return;
      const target = monitorVideoTime(clock.now() - startedAt, video.duration, loop);
      if (!video.seeking && Math.abs(video.currentTime - target.time) > 0.15) video.currentTime = target.time;
      if (!reportedFrame && video.readyState >= 2 && video.videoWidth > 0 && !video.seeking
        && Math.abs(video.currentTime - target.time) <= 0.15) {
        reportedFrame = true;
        frameCallback.current();
      }
      if (!target.playing) { video.pause(); return; }
      if (video.paused && !pending && Date.now() >= retryAt) {
        pending = true;
        void video.play().then(() => { if (!disposed) onError(""); }).catch(() => {
          retryAt = Date.now() + 2000;
          if (!disposed) onError("Video playback blocked. Check this browser's playback permissions.");
        }).finally(() => { pending = false; });
      }
    };
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("loadeddata", update);
    video.addEventListener("seeked", update);
    const timer = setInterval(update, 50);
    update();
    return () => {
      disposed = true;
      clearInterval(timer);
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("loadeddata", update);
      video.removeEventListener("seeked", update);
      video.pause();
    };
  }, [src, startedAt, loop, clock, active, onError]);
  return <video ref={ref} src={src} muted playsInline preload="auto" style={{ objectFit: fit, opacity: hidden ? 0 : 1 }} onError={() => { if (active) onError("Video could not be decoded"); }} />;
}
