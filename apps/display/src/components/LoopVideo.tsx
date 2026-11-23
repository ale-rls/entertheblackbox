import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import { monitorVideoTime } from "../monitors/playback.js";

/** `anchorAt`: server time of the loop's first frame (its run of scenes began); without it the loop follows the absolute clock. */
export type LoopTarget = { src: string; url: string; anchorAt?: number | undefined };
/** The loop on screen and the element playing it, so a lit curtain can draw the very same frames. */
export type ActiveLoopVideo = { src: string; element: HTMLVideoElement };
type Slot = 0 | 1;

/**
 * Two stable slots for a scene's background loop. The current loop stays on
 * screen until the incoming one has decoded a frame and `revealAllowed` says
 * the foreground is ready too, so the layers change on the same frame. With no
 * loop wanted it clears at once, unless `hold` keeps it until the foreground
 * has replaced it. `pending` means the wanted loop is still resolving.
 * With `fadeOutMs`, a loop that leaves for no loop dissolves into the foreground
 * underneath instead of cutting (a closed curtain into its opening). With
 * `fadeInMs`, a loop that arrives where there was none dissolves in over the
 * foreground's last picture (a curtain closing into the closed curtain).
 * `onShown` fires once a loop that came in where there was none is fully up
 * (after its fade), so the foreground can hold its picture until then.
 */
export function LoopHandoff({ target, pending, hold, revealAllowed, clock, fadeOutMs = 0, fadeInMs = 0, onReadyUrl, onActiveSrc, onShown, onActiveVideo }: {
  target: LoopTarget | null;
  pending: boolean;
  hold: boolean;
  revealAllowed: boolean;
  clock: ServerClock;
  fadeOutMs?: number;
  fadeInMs?: number;
  /** The loop URL that could be on screen now: a framed incoming loop, else the current one. */
  onReadyUrl?: (url: string | null) => void;
  onActiveSrc?: (src: string | null) => void;
  onShown?: () => void;
  onActiveVideo?: (video: ActiveLoopVideo | null) => void;
}) {
  const [slots, setSlots] = useState<[LoopTarget | null, LoopTarget | null]>([null, null]);
  const [active, setActive] = useState<Slot | null>(null);
  const [framed, setFramed] = useState<[string | null, string | null]>([null, null]);
  const [fading, setFading] = useState(false);
  /** The slot dissolving in, until its fade has run. */
  const [fadingIn, setFadingIn] = useState<Slot | null>(null);
  const elements = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const current = active === null ? null : slots[active];
  const other: Slot = active === 0 ? 1 : 0;
  // A slot's frame belongs to the element it was reported by: filling or emptying the slot
  // forgets it, so a loop that comes back to the same slot waits for its new element's frame.
  const place = useCallback((slot: Slot, value: LoopTarget | null) => {
    setSlots((previous) => withSlot(previous, slot, value));
    setFramed((previous) => previous[slot] === null ? previous : withSlot(previous, slot, null));
  }, []);

  useLayoutEffect(() => {
    if (pending) return;
    if (target === null) {
      if (slots[other] !== null) place(other, null);
      if (!hold && active !== null) {
        if (fadeOutMs > 0) {
          setFading(true);
          return;
        }
        setActive(null);
        place(0, null);
        place(1, null);
      }
      return;
    }
    if (fading) setFading(false);
    if (current !== null && sameLoop(current, target)) {
      if (slots[other] !== null) place(other, null);
      return;
    }
    if (slots[other] === null || !sameLoop(slots[other], target)) {
      place(other, target);
      return;
    }
    if (revealAllowed && framed[other] === target.url) {
      if (active === null && fadeInMs > 0) setFadingIn(other);
      else if (active === null) onShown?.();
      setActive(other);
      if (active !== null) place(active, null);
    }
  }, [target, pending, hold, revealAllowed, slots, active, current, other, framed, place, fadeOutMs, fadeInMs, fading, onShown]);

  useEffect(() => {
    if (fadingIn === null) return;
    const timer = setTimeout(() => { setFadingIn(null); onShown?.(); }, fadeInMs);
    return () => clearTimeout(timer);
  }, [fadingIn, fadeInMs, onShown]);

  // The dissolve's end: the faded loop leaves.
  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => {
      setFading(false);
      setActive(null);
      place(0, null);
      place(1, null);
    }, fadeOutMs);
    return () => clearTimeout(timer);
  }, [fading, fadeOutMs, place]);

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

  const activeElement = active === null ? null : elements.current[active];
  useEffect(() => {
    onActiveVideo?.(activeSrc === null || activeElement === null ? null : { src: activeSrc, element: activeElement });
  }, [activeSrc, activeElement, onActiveVideo]);

  const markFramed = useCallback((slot: Slot, url: string) => {
    setFramed((previous) => previous[slot] === url ? previous : withSlot(previous, slot, url));
  }, []);

  return <>
    {([0, 1] as const).map((slot) => {
      const value = slots[slot];
      if (value === null) return null;
      return <LoopVideo
        key={`${slot}:${value.url}:${value.anchorAt ?? ""}`}
        src={value.url}
        clock={clock}
        anchorAt={value.anchorAt}
        active={active === slot}
        fadeOutMs={fading && active === slot ? fadeOutMs : 0}
        fadeInMs={fadingIn === slot ? fadeInMs : 0}
        onElement={(element) => { elements.current[slot] = element; }}
        onFirstFrame={() => markFramed(slot, value.url)}
      />;
    })}
  </>;
}

function sameLoop(a: LoopTarget, b: LoopTarget): boolean {
  return a.url === b.url && a.anchorAt === b.anchorAt;
}

function withSlot<T>(slots: [T, T], slot: Slot, value: T): [T, T] {
  const next: [T, T] = [...slots];
  next[slot] = value;
  return next;
}

/**
 * A scene's muted background loop (e.g. an idle curtain). Its position follows
 * the server clock from `anchorAt`, where its run of scenes began (else from the
 * absolute clock), so consecutive scenes sharing the loop run on without a jump
 * and every display shows the same frame. `fadeOutMs` > 0 dissolves it away.
 */
export function LoopVideo({ src, clock, anchorAt, active = true, fadeOutMs = 0, fadeInMs = 0, onFirstFrame, onElement }: {
  src: string;
  clock: ServerClock;
  anchorAt?: number | undefined;
  active?: boolean;
  fadeOutMs?: number;
  fadeInMs?: number;
  onFirstFrame?: () => void;
  onElement?: (element: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const elementCallback = useRef(onElement);
  elementCallback.current = onElement;
  const setRef = useCallback((element: HTMLVideoElement | null) => {
    ref.current = element;
    elementCallback.current?.(element);
  }, []);
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
      const target = loopVideoTime(clock.now(), video.duration, anchorAt);
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
  }, [src, clock, anchorAt]);
  return <video
    ref={setRef}
    className={`phase-loop-video${active ? " phase-loop-video-active" : ""}`}
    style={fadeOutMs > 0 ? { opacity: 0, transition: `opacity ${fadeOutMs}ms linear` }
      : fadeInMs > 0 ? { animation: `phase-loop-fade-in ${fadeInMs}ms linear both` } : undefined}
    src={src}
    muted
    loop
    playsInline
    preload="auto"
    aria-hidden="true"
  />;
}

/**
 * Position in seconds for a loop of `durationSeconds` at server time `nowMs`, or null when unknown.
 * From `anchorAt` (its first frame) when given, else on the absolute clock.
 */
export function loopVideoTime(nowMs: number, durationSeconds: number, anchorAt?: number): number | null {
  const target = monitorVideoTime(anchorAt === undefined ? nowMs : Math.max(0, nowMs - anchorAt), durationSeconds, true);
  return target.playing ? target.time : null;
}
