import { useEffect, useRef } from "react";
import type { ServerClock } from "../lib/serverClock.js";

/** Scene audio level while an operator announcement speaks. */
export const DUCK_LEVEL = 0.25;
const FADE_MS = 400;

export type PlayingAnnouncement = { id: string; url: string; startedAt: number; durationMs: number };

/**
 * Lowers every other `<audio>`/`<video>` on the page to `level`, including
 * media mounted while ducked (a scene change mid-announcement), and returns a
 * function that fades them back. Only elements this ducked are restored.
 */
export function duckPageMedia(root: ParentNode & Node, level: number, fadeMs = FADE_MS): () => void {
  const original = new Map<HTMLMediaElement, number>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  const fade = (element: HTMLMediaElement, to: number) => {
    const from = element.volume;
    if (fadeMs <= 0 || from === to) { element.volume = to; return; }
    const started = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / fadeMs);
      element.volume = from + (to - from) * t;
      if (t >= 1) { clearInterval(timer); timers.delete(timer); }
    }, 40);
    timers.add(timer);
  };
  const duck = (element: Element) => {
    if (!(element instanceof HTMLMediaElement) || original.has(element)) return;
    original.set(element, element.volume);
    fade(element, Math.min(element.volume, level));
  };
  const scan = () => root.querySelectorAll("audio, video").forEach(duck);
  scan();
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(scan);
  observer?.observe(root, { childList: true, subtree: true });
  return () => {
    observer?.disconnect();
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    for (const [element, volume] of original) fade(element, volume);
  };
}

/**
 * Plays an operator voice announcement (Admin → Announcements) on the main
 * display, aligned to the server clock so a reloaded display picks it up
 * mid-sentence, and ducks the scene's own audio while it speaks. The voice is
 * a detached Audio element, so it plays in every display state (idle, hold,
 * scene) and is never ducked itself.
 */
export function useAnnouncementVoice(announcement: PlayingAnnouncement | null, clock: ServerClock, soundEnabled: boolean, onFinished: () => void, root: (ParentNode & Node) | null = typeof document === "undefined" ? null : document): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => { if (audioRef.current) audioRef.current.muted = !soundEnabled; }, [soundEnabled]);

  useEffect(() => {
    if (announcement === null) return;
    const audio = new Audio(announcement.url);
    audio.preload = "auto";
    audio.muted = !soundEnabled;
    audioRef.current = audio;
    const restore = root ? duckPageMedia(root, DUCK_LEVEL) : () => {};
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      const offsetMs = clock.now() - announcement.startedAt;
      if (offsetMs >= announcement.durationMs) { finished.current(); return; }
      if (offsetMs < 0) { startTimer = setTimeout(start, -offsetMs); return; }
      try { audio.currentTime = offsetMs / 1000; } catch { /* Not seekable yet: start from the top. */ }
      void audio.play()?.catch((error: unknown) => console.warn("display: announcement could not play:", error));
    };
    start();
    audio.addEventListener("ended", () => finished.current());
    // Ends on the server's schedule even if the element stalls or errors.
    const endTimer = setTimeout(() => finished.current(), Math.max(0, announcement.startedAt + announcement.durationMs - clock.now()) + 500);
    return () => {
      if (startTimer !== undefined) clearTimeout(startTimer);
      clearTimeout(endTimer);
      audio.pause();
      audio.removeAttribute("src");
      audioRef.current = null;
      restore();
    };
    // soundEnabled is applied by its own effect; a toggle must not restart the clip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcement?.id, announcement?.startedAt, announcement?.durationMs, announcement?.url, clock, root]);
}
