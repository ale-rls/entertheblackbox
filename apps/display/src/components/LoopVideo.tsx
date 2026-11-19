import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import { monitorVideoTime } from "../monitors/playback.js";

export type LoopTarget = { src: string; url: string };
type Slot = 0 | 1;

/**
 * Two stable slots for a scene's background loop. The current loop stays on
 * screen until the incoming one has decoded a frame and `revealAllowed` says
 * the foreground is ready too, so the layers change on the same frame. With no
 * loop wanted it clears at once, unless `hold` keeps it until the foreground
 * has replaced it. `pending` means the wanted loop is still resolving.
 */
export function LoopHandoff({ target, pending, hold, revealAllowed, clock, onReadyUrl, onActiveSrc }: {
  target: LoopTarget | null;
  pending: boolean;
  hold: boolean;
  revealAllowed: boolean;
  clock: ServerClock;
  /** The loop URL that could be on screen now: a framed incoming loop, else the current one. */
  onReadyUrl?: (url: string | null) => void;
  onActiveSrc?: (src: string | null) => void;
}) {
  const [slots, setSlots] = useState<[LoopTarget | null, LoopTarget | null]>([null, null]);
  const [active, setActive] = useState<Slot | null>(null);
  const [framed, setFramed] = useState<[string | null, string | null]>([null, null]);
  const current = active === null ? null : slots[active];
  const other: Slot = active === 0 ? 1 : 0;

  useLayoutEffect(() => {
    if (pending) return;
    if (target === null) {
      if (slots[other] !== null) setSlots((previous) => withSlot(previous, other, null));
      if (!hold && active !== null) {
        setActive(null);
        setSlots([null, null]);
      }
      return;
    }
    if (current?.url === target.url) {
      if (slots[other] !== null) setSlots((previous) => withSlot(previous, other, null));
      return;
    }
    if (slots[other]?.url !== target.url) {
      setSlots((previous) => withSlot(previous, other, target));
      return;
    }
    if (revealAllowed && framed[other] === target.url) {
      setActive(other);
      if (active !== null) setSlots((previous) => withSlot(previous, active, null));
    }
  }, [target, pending, hold, revealAllowed, slots, active, current, other, framed]);

  const incoming = slots[other];
  const readyUrl = incoming !== null && framed[other] === incoming.url ? incoming.url : current?.url ?? null;
  useEffect(() => { onReadyUrl?.(readyUrl); }, [readyUrl, onReadyUrl]);
  const activeSrc = current?.src ?? null;
  const reportedSrc = useRef<string | null>(null);
  useEffect(() => {
    if (reportedSrc.current === activeSrc) return;
    reportedSrc.current = activeSrc;
    onActiveSrc?.(activeSrc);
  }, [activeSrc, onActiveSrc]);

  const markFramed = useCallback((slot: Slot, url: string) => {
    setFramed((previous) => previous[slot] === url ? previous : withSlot(previous, slot, url));
  }, []);

  return <>
    {([0, 1] as const).map((slot) => {
      const value = slots[slot];
      if (value === null) return null;
      return <LoopVideo
        key={`${slot}:${value.url}`}
        src={value.url}
        clock={clock}
        active={active === slot}
        onFirstFrame={() => markFramed(slot, value.url)}
      />;
    })}
  </>;
}

function withSlot<T>(slots: [T, T], slot: Slot, value: T): [T, T] {
  const next: [T, T] = [...slots];
  next[slot] = value;
  return next;
}

/**
 * A scene's muted background loop (e.g. an idle curtain). Its position follows
 * the absolute server clock, not the scene start, so consecutive scenes sharing
 * the loop run on without a jump and every display shows the same frame.
 */
export function LoopVideo({ src, clock, active = true, onFirstFrame }: {
  src: string;
  clock: ServerClock;
  active?: boolean;
  onFirstFrame?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const firstFrame = useRef(onFirstFrame);
  useLayoutEffect(() => { firstFrame.current = onFirstFrame; }, [onFirstFrame]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let pending = false;
    let retryAt = 0;
    let framed = false;
    let disposed = false;
    let frameCallback: number | null = null;
    const reportFrame = () => {
      if (framed || disposed) return;
      framed = true;
      if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback);
      frameCallback = null;
      firstFrame.current?.();
    };
    if (typeof video.requestVideoFrameCallback === "function") {
      frameCallback = video.requestVideoFrameCallback(() => { frameCallback = null; reportFrame(); });
    }
    const update = () => {
      // A hidden incoming loop may never get a compositor callback; a decoded,
      // playing frame that is not mid-seek is enough to show it.
      if (video.readyState >= 2 && video.videoWidth > 0 && !video.seeking && !video.paused) reportFrame();
      if (video.readyState < 1 || !clock.ready) return;
      const target = loopVideoTime(clock.now(), video.duration);
      if (target === null) return;
      if (!video.seeking && Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
      if (video.paused && !pending && Date.now() >= retryAt) {
        pending = true;
        void video.play().catch(() => { retryAt = Date.now() + 2000; }).finally(() => { pending = false; });
      }
    };
    // An undecodable loop must not keep the other layer waiting for it.
    const failed = () => reportFrame();
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("loadeddata", update);
    video.addEventListener("seeked", update);
    video.addEventListener("playing", update);
    video.addEventListener("error", failed);
    const timer = setInterval(update, 250);
    update();
    return () => {
      disposed = true;
      clearInterval(timer);
      if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback);
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("loadeddata", update);
      video.removeEventListener("seeked", update);
      video.removeEventListener("playing", update);
      video.removeEventListener("error", failed);
      video.pause();
    };
  }, [src, clock]);
  return <video
    ref={ref}
    className={`phase-loop-video${active ? " phase-loop-video-active" : ""}`}
    src={src}
    muted
    loop
    playsInline
    preload="auto"
    aria-hidden="true"
  />;
}

/** Position in seconds for a loop of `durationSeconds` at server time `nowMs`, or null when unknown. */
export function loopVideoTime(nowMs: number, durationSeconds: number): number | null {
  const target = monitorVideoTime(nowMs, durationSeconds, true);
  return target.playing ? target.time : null;
}
