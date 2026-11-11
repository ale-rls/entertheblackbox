/** Audio cut before its natural end fades out over this long instead of stopping hard. */
export const SKIP_FADE_MS = 3000;
const STEP_MS = 30;

type FadeCopy = Pick<HTMLAudioElement, "src" | "volume" | "currentTime" | "play" | "pause" | "load" | "removeAttribute" | "addEventListener"> & { preload: string };

let holdUrl: ((url: string, ms: number) => void) | null = null;
let createCopy: () => FadeCopy = () => new Audio();
const now = () => Date.now();

/** The media store keeps the outgoing Blob URL alive while a copy fades from it. */
export function setSkipFadeUrlHold(hold: ((url: string, ms: number) => void) | null): void {
  holdUrl = hold;
}

/** Test seam for the detached audio element. */
export function setSkipFadeCopyFactory(factory: () => FadeCopy): void {
  createCopy = factory;
}

/**
 * Call where audible phase media is about to be cut (paused or unmounted) because the show
 * moved on. If the element is still sounding, a detached copy continues from the same position
 * and ramps to silence over `SKIP_FADE_MS`; the caller then stops the original as before, so
 * the picture still cuts. Media that ended naturally, is paused or is muted is left alone.
 */
export function fadeOutSkippedAudio(media: HTMLMediaElement | null | undefined, durationMs = SKIP_FADE_MS): boolean {
  if (!media || media.paused || media.ended || media.muted || media.volume === 0) return false;
  const url = media.currentSrc || media.src;
  if (!url) return false;
  holdUrl?.(url, durationMs + 1000);
  const from = media.volume;
  const offset = media.currentTime;
  const startedAt = now();
  const copy = createCopy();
  copy.preload = "auto";
  copy.volume = from;
  copy.addEventListener("loadedmetadata", () => {
    copy.currentTime = offset + (now() - startedAt) / 1000;
    void Promise.resolve(copy.play()).catch(() => {});
  }, { once: true });
  copy.src = url;
  const timer = setInterval(() => {
    const progress = (now() - startedAt) / durationMs;
    if (progress < 1) { copy.volume = Math.max(0, from * (1 - progress)); return; }
    clearInterval(timer);
    copy.pause();
    copy.removeAttribute("src");
    copy.load();
  }, STEP_MS);
  return true;
}
