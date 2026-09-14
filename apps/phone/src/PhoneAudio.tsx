import { useEffect, useRef, useState } from "react";
import { AudioPlayback, playbackAction, playbackMessage, type PlaybackState } from "./lib/audio-playback";

/** One native media element stays mounted across scene and WebSocket changes. */
export function PhoneAudio({ participantLease }: { participantLease: string }) {
  const element = useRef<HTMLAudioElement>(null);
  const player = useRef<AudioPlayback>();
  const [url, setUrl] = useState<string | null>(null);
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
        if (!abort.signal.aborted) setUrl(data.streamUrl);
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

  useEffect(() => {
    if (!url) return;
    const mediaSession = navigator.mediaSession;
    const playback = new AudioPlayback(element.current!, url, (next) => {
      setState(next);
      if (mediaSession) mediaSession.playbackState = next === "playing" ? "playing" : next === "paused" ? "paused" : "none";
      void fetch("/api/audio/event", { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantLease, state: next, at: Date.now() }) })
        .catch(() => { /* Best-effort diagnostics; must never affect playback. */ });
    });
    player.current = playback;
    setState("ready");
    const visible = () => { if (!document.hidden) playback.check(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", playback.check);
    window.addEventListener("online", playback.check);
    if (mediaSession) {
      if (typeof MediaMetadata !== "undefined") mediaSession.metadata = new MediaMetadata({ title: "Enter the Blackbox", artist: "Your headphones" });
      mediaSession.setActionHandler("play", playback.play);
      mediaSession.setActionHandler("pause", playback.pause);
    }
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", playback.check);
      window.removeEventListener("online", playback.check);
      mediaSession?.setActionHandler("play", null);
      mediaSession?.setActionHandler("pause", null);
      if (mediaSession) mediaSession.playbackState = "none";
      playback.dispose();
      player.current = undefined;
    };
  }, [url]);

  const action = url ? playbackAction(state) : null;
  return <section className="phone-audio" aria-label="Headphone audio" onPointerDown={(event) => event.stopPropagation()}>
    <audio ref={element} preload="none" />
    <p role="status">{url ? playbackMessage[state] : registration}</p>
    {action && <button type="button" onClick={() => player.current?.play()}>{action}</button>}
  </section>;
}
