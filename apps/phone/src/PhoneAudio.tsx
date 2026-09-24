import { JanusPlayback, parseJanusFeed } from "./lib/janus-playback";
import { runtimeApi } from "@entertheblackbox/protocol";
import { useEffect, useRef, useState } from "react";
import { AudioPlayback, playbackAction, playbackMessage, type PlaybackState } from "./lib/audio-playback";

/** One native media element stays mounted across scene and WebSocket changes. */
export function PhoneAudio({ transport = "icecast", autoStart = false, participantLease, streamUrlOverride, suspended = false, active = true, sceneKey = "" }: { transport?: "icecast" | "janus"; autoStart?: boolean; participantLease: string; streamUrlOverride?: string | null; suspended?: boolean; active?: boolean; sceneKey?: string }) {
  const api = transport === "janus" ? "/api/audio-janus" : "/api/audio";
  const cue = JSON.stringify([sceneKey, active, suspended]);
  const [readiness, setReadiness] = useState({ cue, ready: false });
  if (readiness.cue !== cue) setReadiness({ cue, ready: false });
  const awaitingCue = readiness.cue !== cue || !readiness.ready;
  const pauseForScene = suspended || !active || awaitingCue;
  const element = useRef<HTMLAudioElement>(null);
  const player = useRef<AudioPlayback | JanusPlayback>();
  const [url, setUrl] = useState<string | null>(null);
  const override = useRef(streamUrlOverride);
  override.current = streamUrlOverride;
  const hasUrl = url !== null;
  const lease = useRef(participantLease);
  lease.current = participantLease;
  const [state, setState] = useState<PlaybackState>("ready");
  const [registration, setRegistration] = useState("Preparing headphones…");

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function register() {
      const requestAbort = new AbortController();
      const cancel = () => requestAbort.abort();
      abort.signal.addEventListener("abort", cancel);
      const deadline = setTimeout(cancel, 15_000);
      try {
        const response = await fetch(runtimeApi(`${api}/register`), { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantLease }),
          signal: requestAbort.signal });
        if (!response.ok) throw new Error("Headphone audio unavailable. Retrying… Please keep this page open.");
        const data = await response.json() as { streamUrl?: unknown; janus?: unknown };
        const streamUrl = transport === "janus" ? JSON.stringify(parseJanusFeed(data.janus)) : data.streamUrl;
        if (typeof streamUrl !== "string" || !streamUrl) throw new Error("Headphone audio unavailable. Please ask the staff.");
        if (!abort.signal.aborted) {
          setUrl(transport === "janus" ? streamUrl : override.current || streamUrl);
          setReadiness({ cue, ready: true });
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        setRegistration(error instanceof Error ? error.message : "Headphone audio unavailable. Retrying…");
        timer = setTimeout(() => void register(), 5_000);
      } finally {
        clearTimeout(deadline);
        abort.signal.removeEventListener("abort", cancel);
      }
    }
    void register();
    return () => { abort.abort(); clearTimeout(timer); };
    // Registration waits for queued bridge reset/play work before returning.
    // Re-check each scene/group cue even if its stream URL stays the same.
  }, [participantLease, cue, transport]);

  // Clearing the override during identity renewal must not switch back to an
  // old registration URL while the new registration request is pending.
  useEffect(() => {
    if (transport === "icecast" && streamUrlOverride) setUrl(streamUrlOverride);
  }, [streamUrlOverride]);

  useEffect(() => {
    if (!url) return;
    const mediaSession = navigator.mediaSession;
    const changed = (next: PlaybackState) => {
      setState(next);
      try {
        if (mediaSession) mediaSession.playbackState = next === "paused" || next === "blocked" ? "paused"
          : next === "ready" ? "none" : "playing";
      } catch { /* Optional OS integration must not interrupt the stream. */ }
      void fetch(runtimeApi(`${api}/event`), { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantLease: lease.current, state: next, at: Date.now() }) })
        .catch(() => { /* Best-effort diagnostics; must never affect playback. */ });
    };
    const refresh = async () => {
      const response = await fetch(runtimeApi(`${api}/register`), { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantLease: lease.current, recover: true }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Audio recovery unavailable");
      return parseJanusFeed((await response.json()).janus);
    };
    const playback = transport === "janus"
      ? new JanusPlayback(element.current!, url, changed, refresh)
      : new AudioPlayback(element.current!, url, changed);
    playback.setSuspended(pauseForScene);
    player.current = playback;
    setState("ready");
    // One initial attempt only; explicit pause and browser blocking stay authoritative.
    if (autoStart && transport === "icecast") playback.play();
    const visible = () => { if (!document.hidden) playback.foreground(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", playback.foreground);
    window.addEventListener("online", playback.online);
    if (mediaSession) {
      try {
        if (typeof MediaMetadata !== "undefined") mediaSession.metadata = new MediaMetadata({ title: "Enter the Blackbox", artist: "Your headphones" });
      } catch { /* Optional metadata. */ }
      try { mediaSession.setActionHandler("play", playback.play); } catch { /* Unsupported action. */ }
      try { mediaSession.setActionHandler("pause", playback.pause); } catch { /* Unsupported action. */ }
    }
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", playback.foreground);
      window.removeEventListener("online", playback.online);
      try { mediaSession?.setActionHandler("play", null); } catch { /* Unsupported action. */ }
      try { mediaSession?.setActionHandler("pause", null); } catch { /* Unsupported action. */ }
      try { if (mediaSession) mediaSession.playbackState = "none"; } catch { /* Optional API. */ }
      playback.dispose();
      player.current = undefined;
    };
    // URL/lease changes must not dispose a playing native media session.
  }, [hasUrl, transport]);

  useEffect(() => {
    if (url) player.current?.setUrl(url);
  }, [url]);

  useEffect(() => { player.current?.setSuspended(pauseForScene); }, [pauseForScene, hasUrl]);

  const action = url && !awaitingCue ? playbackAction(state) : null;
  const message = url && !awaitingCue ? playbackMessage[state] : registration;
  return <section style={suspended || !active || message === null ? { display: "none" } : undefined} className="phone-audio" aria-label="Headphone audio" onPointerDown={(event) => event.stopPropagation()}>
    <audio ref={element} preload="none" />
    {message && <p role="status">{message}</p>}
    {action && <button type="button" onClick={() => player.current?.play()}>{action}</button>}
  </section>;
}
