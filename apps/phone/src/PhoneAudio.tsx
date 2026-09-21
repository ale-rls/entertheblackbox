import { useEffect, useRef, useState } from "react";
import { AudioPlayback, playbackAction, playbackMessage, type PlaybackState } from "./lib/audio-playback";

/** One native media element stays mounted across scene and WebSocket changes. */
export function PhoneAudio({ participantLease, streamUrlOverride, suspended = false }: { participantLease: string; streamUrlOverride?: string | null; suspended?: boolean }) {
  const element = useRef<HTMLAudioElement>(null);
  const player = useRef<AudioPlayback>();
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
        const response = await fetch("/api/audio/register", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantLease }),
          signal: requestAbort.signal });
        if (!response.ok) throw new Error("Headphone audio unavailable. Retrying… Please keep this page open.");
        const data = await response.json() as { streamUrl?: unknown };
        if (typeof data.streamUrl !== "string" || !data.streamUrl) throw new Error("Headphone audio unavailable. Please ask the staff.");
        if (!abort.signal.aborted) setUrl(override.current || data.streamUrl);
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
  }, [participantLease]);

  // Clearing the override during identity renewal must not switch back to an
  // old registration URL while the new registration request is pending.
  useEffect(() => {
    if (streamUrlOverride) setUrl(streamUrlOverride);
  }, [streamUrlOverride]);

  useEffect(() => {
    if (!url) return;
    const mediaSession = navigator.mediaSession;
    const playback = new AudioPlayback(element.current!, url, (next) => {
      setState(next);
      try {
        if (mediaSession) mediaSession.playbackState = next === "paused" || next === "blocked" ? "paused"
          : next === "ready" ? "none" : "playing";
      } catch { /* Optional OS integration must not interrupt the stream. */ }
      void fetch("/api/audio/event", { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantLease: lease.current, state: next, at: Date.now() }) })
        .catch(() => { /* Best-effort diagnostics; must never affect playback. */ });
    });
    playback.setSuspended(suspended);
    player.current = playback;
    setState("ready");
    const visible = () => { if (!document.hidden) playback.foreground(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", playback.foreground);
    window.addEventListener("online", playback.online);
    let handlesPause = false;
    if (mediaSession) {
      try {
        if (typeof MediaMetadata !== "undefined") mediaSession.metadata = new MediaMetadata({ title: "Enter the Blackbox", artist: "Your headphones" });
      } catch { /* Optional metadata. */ }
      try { mediaSession.setActionHandler("play", playback.play); } catch { /* Unsupported action. */ }
      try { mediaSession.setActionHandler("pause", playback.pause); handlesPause = true; } catch { /* Unsupported action. */ }
    }
    playback.setNativePauseFallback(!handlesPause);
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
  }, [hasUrl]);

  useEffect(() => {
    if (url) player.current?.setUrl(url);
  }, [url]);

  useEffect(() => { player.current?.setSuspended(suspended); }, [suspended, hasUrl]);

  const action = url ? playbackAction(state) : null;
  return <section style={suspended ? { display: "none" } : undefined} className="phone-audio" aria-label="Headphone audio" onPointerDown={(event) => event.stopPropagation()}>
    <audio ref={element} preload="none" />
    <p role="status">{url ? playbackMessage[state] : registration}</p>
    {action && <button type="button" onClick={() => player.current?.play()}>{action}</button>}
  </section>;
}
