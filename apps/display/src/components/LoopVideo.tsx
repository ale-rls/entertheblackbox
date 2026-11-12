import { useEffect, useRef } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import { monitorVideoTime } from "../monitors/playback.js";

/**
 * A scene's muted background loop (e.g. an idle curtain). Its position follows
 * the absolute server clock, not the scene start, so consecutive scenes sharing
 * the loop run on without a jump and every display shows the same frame.
 */
export function LoopVideo({ src, clock }: { src: string; clock: ServerClock }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let pending = false;
    let retryAt = 0;
    const update = () => {
      if (video.readyState < 1 || !clock.ready) return;
      const target = loopVideoTime(clock.now(), video.duration);
      if (target === null) return;
      if (!video.seeking && Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
      if (video.paused && !pending && Date.now() >= retryAt) {
        pending = true;
        void video.play().catch(() => { retryAt = Date.now() + 2000; }).finally(() => { pending = false; });
      }
    };
    video.addEventListener("loadedmetadata", update);
    const timer = setInterval(update, 250);
    update();
    return () => { clearInterval(timer); video.removeEventListener("loadedmetadata", update); video.pause(); };
  }, [src, clock]);
  return <video ref={ref} className="phase-loop-video" src={src} muted loop playsInline preload="auto" aria-hidden="true" />;
}

/** Position in seconds for a loop of `durationSeconds` at server time `nowMs`, or null when unknown. */
export function loopVideoTime(nowMs: number, durationSeconds: number): number | null {
  const target = monitorVideoTime(nowMs, durationSeconds, true);
  return target.playing ? target.time : null;
}
