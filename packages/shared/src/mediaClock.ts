import type { ServerClock } from "./serverClock.js";

export interface ClockMedia {
  currentTime: number;
  duration: number;
  readyState: number;
  seeking: boolean;
  paused: boolean;
  playbackRate: number;
  pause(): void;
  play(): Promise<void> | undefined;
  addEventListener(event: string, listener: () => void): void;
  removeEventListener(event: string, listener: () => void): void;
}

/**
 * How long past its duration on the clock a playing cue may run to reach its own end.
 * The follower only re-seeks beyond 0.25 s of drift, so playback can trail the clock;
 * stopping it the moment the clock reaches the duration clipped the last word.
 */
export const MEDIA_END_GRACE_S = 1.5;

/** Align finite cue media to the authoritative phase start, including late loads. */
export function followMediaClock(media: ClockMedia, clock: ServerClock, startedAt: number, options: {
  ended: () => void;
  blocked: () => void;
  enabled?: boolean;
}): () => void {
  let completed = false;
  let pending = false;
  let disposed = false;
  let retryAfter = 0;
  const finish = () => {
    if (completed || disposed) return;
    completed = true;
    media.pause();
    options.ended();
  };
  const update = () => {
    if (disposed || completed) return;
    if (options.enabled === false || !clock.ready) { media.pause(); return; }
    const target = (clock.now() - startedAt) / 1000;
    if (target < 0) { media.pause(); return; }
    if (media.readyState < 1) return;
    if (Number.isFinite(media.duration) && target >= media.duration) {
      // A cue still playing towards its end plays out (it fires "ended"); no more seeking or rate nudges.
      const playingOut = !media.paused && media.currentTime < media.duration && target < media.duration + MEDIA_END_GRACE_S;
      if (playingOut) { media.playbackRate = 1; return; }
      if (!media.seeking) media.currentTime = Math.max(0, media.duration - 0.001);
      finish();
      return;
    }
    const error = target - media.currentTime;
    if (!media.seeking && Math.abs(error) > 0.25) media.currentTime = target;
    media.playbackRate = Math.abs(error) < 0.02 ? 1 : Math.max(0.98, Math.min(1.02, 1 + error * 0.1));
    if (media.paused && !pending && Date.now() >= retryAfter) {
      pending = true;
      try {
        void Promise.resolve(media.play()).catch(() => { if (!disposed) { retryAfter = Date.now() + 1000; options.blocked(); } })
          .finally(() => { pending = false; });
      } catch { pending = false; retryAfter = Date.now() + 1000; options.blocked(); }
    }
  };
  media.addEventListener("ended", finish);
  media.addEventListener("loadedmetadata", update);
  media.addEventListener("canplay", update);
  const timer = setInterval(update, 50);
  update();
  return () => {
    disposed = true;
    clearInterval(timer);
    media.removeEventListener("ended", finish);
    media.removeEventListener("loadedmetadata", update);
    media.removeEventListener("canplay", update);
    media.pause();
    media.playbackRate = 1;
  };
}
