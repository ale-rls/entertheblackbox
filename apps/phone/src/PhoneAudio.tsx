import { useEffect, useRef, useState } from "react";
import { AudioProgress, DriftWatch, drifted } from "./lib/audio-progress";

/** One native media element stays mounted across scene and WebSocket changes. */
export function PhoneAudio({ participantLease }: { participantLease: string }) {
  const element = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing headphones…");
  const wanted = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>();
  const attempts = useRef(0);
  const progress = useRef(new AudioProgress());
  const driftWatch = useRef(new DriftWatch());
  const playGeneration = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function register() {
      try {
        const response = await fetch("/api/audio/register", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantLease }), signal: abort.signal });
        if (!response.ok) throw new Error("Headphone stream unavailable. Retrying…");
        const data = await response.json() as { streamUrl: string };
        if (!abort.signal.aborted) { setUrl(data.streamUrl); setStatus("Tap Start headphones before locking your phone."); }
      } catch (error) {
        if (abort.signal.aborted) return;
        setStatus(error instanceof Error ? error.message : "Headphone stream unavailable");
        timer = setTimeout(() => void register(), 5_000);
      }
    }
    void register();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [participantLease]);

  const play = () => {
    const audio = element.current;
    if (!audio || !url) return;
    clearTimeout(retry.current); retry.current = undefined;
    wanted.current = true;
    setStatus("Connecting headphones…");
    // Reconnect at the live edge; never resume buffered narration from a paused scene.
    audio.src = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    audio.load();
    progress.current.reset(audio.currentTime);
    driftWatch.current.reset();
    const generation = ++playGeneration.current;
    void audio.play().catch((error: unknown) => {
      if (generation !== playGeneration.current || !wanted.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        wanted.current = false;
        setStatus("Tap Start headphones to allow playback.");
      } else scheduleRetry();
    });
  };
  const scheduleRetry = () => {
    if (!wanted.current || retry.current !== undefined) return;
    setStatus("Audio interrupted. Reconnecting…");
    retry.current = setTimeout(() => {
      retry.current = undefined;
      play();
    }, Math.min(8_000, 500 * 2 ** Math.min(attempts.current++, 4)));
  };

  useEffect(() => {
    if (!url) return;
    const audio = element.current!;
    progress.current.reset(audio.currentTime);
    driftWatch.current.reset();
    const watchdog = setInterval(() => {
      if (!wanted.current || document.hidden) return;
      const bufferedEnd = audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : audio.currentTime;
      const backlogPersists = driftWatch.current.persists(drifted(bufferedEnd, audio.currentTime));
      if (progress.current.stalled(audio.currentTime) || audio.ended || audio.error || backlogPersists) scheduleRetry();
    }, 5_000);
    const visible = () => {
      progress.current.reset(audio.currentTime);
      driftWatch.current.reset();
      if (!document.hidden && wanted.current && (audio.paused || audio.error)) play();
    };
    document.addEventListener("visibilitychange", visible);
    const mediaSession = navigator.mediaSession;
    if (mediaSession) {
      mediaSession.metadata = new MediaMetadata({ title: "Enter the Blackbox", artist: "Your headphones" });
      mediaSession.setActionHandler("play", play);
      mediaSession.setActionHandler("pause", () => {
        wanted.current = false;
        clearTimeout(retry.current); retry.current = undefined;
        audio.pause(); setStatus("Headphones paused. Tap Start headphones to resume.");
      });
    }
    return () => {
      clearInterval(watchdog); clearTimeout(retry.current); retry.current = undefined;
      wanted.current = false;
      ++playGeneration.current;
      document.removeEventListener("visibilitychange", visible);
      mediaSession?.setActionHandler("play", null); mediaSession?.setActionHandler("pause", null);
      audio.pause(); audio.removeAttribute("src"); audio.load();
    };
  }, [url]);

  return <section className="phone-audio" aria-label="Headphone audio" onPointerDown={(event) => event.stopPropagation()}>
    <audio ref={element} preload="none" onError={scheduleRetry} onEnded={scheduleRetry}
      onPlaying={() => { progress.current.reset(element.current?.currentTime ?? 0); driftWatch.current.reset(); attempts.current = 0; clearTimeout(retry.current); retry.current = undefined; setStatus("Headphones playing. You can lock your phone."); }} />
    <p role="status">{status}</p>
    <button type="button" disabled={!url} onClick={play}>Start headphones</button>
  </section>;
}
