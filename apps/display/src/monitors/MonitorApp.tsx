import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { activeMonitorCue, type MonitorId } from "@entertheblackbox/scenario";
import { rehearsalId, runtimeWebSocket } from "@entertheblackbox/protocol";
import type { ServerClock } from "@entertheblackbox/shared";
import { DisplayConnection } from "../lib/connection.js";
import { currentInstallation } from "../lib/resolveInstallation.js";
import { displayReducer, initialDisplayState } from "../state/store.js";
import { useMedia } from "../media/useMedia.js";
import { FullscreenControl } from "../components/FullscreenControl.js";
import { performReload } from "../lib/kiosk.js";
import { monitorVideoTime } from "./playback.js";
import "./monitors.css";

declare const __BUILD_VERSION__: string | undefined;
declare const __DISPLAY_TOKEN__: string | undefined;

export function MonitorApp({ monitorId }: { monitorId: MonitorId }) {
  const [state, dispatch] = useReducer(displayReducer, initialDisplayState);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const setup = new URLSearchParams(location.search).get("setup") === "1";
  const connection = useMemo(() => new DisplayConnection({
    url: runtimeWebSocket(location), ...currentInstallation(), monitorId,
    displayToken: rehearsalId() ?? (typeof __DISPLAY_TOKEN__ === "string" ? __DISPLAY_TOKEN__ : ""),
    clientVersion: typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "0.0.0-dev",
    onMessage: (message) => dispatch({ type: "server-message", message }),
    onStatusChange: (status) => dispatch({ type: "connection-status", status }),
  }), [monitorId]);
  // All declared media is hash/size verified before the screen reports ready.
  // A changed scenario revision revalidates the manifest and clears old URLs.
  const mediaRevision = rehearsalId() ? state.sessionId ?? "" : state.phase?.scenarioVersion ?? "";
  const media = useMedia(undefined, mediaRevision);
  useEffect(() => {
    connection.start();
    const timer = setInterval(() => setNow(connection.clock.now()), 33);
    return () => { clearInterval(timer); connection.stop(); };
  }, [connection]);
  useEffect(() => { if (state.reloadRequired) void performReload(); }, [state.reloadRequired]);
  const phase = state.phase;
  const cue = phase && connection.clock.ready ? activeMonitorCue(phase.monitorCues?.[monitorId] ?? [], now - phase.startedAt) : null;
  const src = cue && "src" in cue ? cue.src : null;
  useEffect(() => {
    setError("");
    void media.showMedia(src).catch((cause) => setError(String(cause)));
  }, [src, state.sessionId, state.phaseEpoch, mediaRevision]);
  const url = media.visualSrc === src ? media.videoUrl : null;
  const ready = media.status.state === "ready";
  const key = `${state.sessionId}:${state.phaseEpoch}:${cue?.startMs}`;
  return <main className="monitor-root" aria-label={`Monitor ${monitorId}`}>
    {ready && cue?.kind === "text" && <div className="monitor-text">{cue.text}</div>}
    {ready && cue?.kind === "placeholder" && <div className="monitor-placeholder"><small>{monitorId} · PLACEHOLDER</small><div>{cue.text}</div></div>}
    {ready && cue?.kind === "image" && url && <figure className="monitor-image"><img src={url} alt={cue.text ?? ""} style={{ objectFit: cue.fit }} onError={() => setError("Image could not be decoded")} />{cue.text && <figcaption>{cue.text}</figcaption>}</figure>}
    {ready && cue?.kind === "video" && url && phase && <MonitorVideo key={key} src={url} startedAt={phase.startedAt + cue.startMs} loop={cue.loop} fit={cue.fit} clock={connection.clock} onError={setError} />}
    {(!ready || setup || state.connection !== "open" || error || state.notice) && <aside className="monitor-status" role="status">
      <strong>{monitorId}</strong> · {state.connection} · {media.status.state}{ready ? " — media verified" : " — preparing media"}
      {media.status.state === "downloading" && <p>{media.status.done}/{media.status.total}: {media.status.current}</p>}
      {media.status.state === "retrying" && <p>{media.status.lastError} — retrying</p>}
      {phase && <p>{phase.id} · {Math.max(0, Math.floor((now - phase.startedAt) / 1000))}s</p>}
      {state.connection !== "open" && <p>Waiting for server cues. The last received cue stays on its original clock.</p>}
      {(error || state.notice) && <p role="alert">{error || state.notice?.message}</p>}
      {setup && <FullscreenControl />}
    </aside>}
  </main>;
}

function MonitorVideo({ src, startedAt, loop, fit, clock, onError }: {
  src: string; startedAt: number; loop: boolean; fit: "contain" | "cover"; clock: ServerClock; onError: (message: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let pending = false;
    let disposed = false;
    let retryAt = 0;
    const update = () => {
      if (video.readyState < 1 || !clock.ready) return;
      const target = monitorVideoTime(clock.now() - startedAt, video.duration, loop);
      if (!video.seeking && Math.abs(video.currentTime - target.time) > 0.15) video.currentTime = target.time;
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
    const timer = setInterval(update, 50);
    update();
    return () => { disposed = true; clearInterval(timer); video.removeEventListener("loadedmetadata", update); video.pause(); };
  }, [src, startedAt, loop, clock, onError]);
  return <video ref={ref} src={src} muted playsInline preload="auto" style={{ objectFit: fit }} onError={() => onError("Video could not be decoded")} />;
}
