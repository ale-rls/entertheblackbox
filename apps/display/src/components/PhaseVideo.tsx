import { followMediaClock, type ServerClock } from "@entertheblackbox/shared";
import { useCallback, useEffect, useRef } from "react";
import {
  PROTOCOL_VERSION,
  type DisplayToServerMessage,
  type PhaseSnapshotMessage,
} from "@entertheblackbox/protocol";
import { useVideoPlaybackDiagnostics } from "../media/useVideoPlaybackDiagnostics.js";

type VideoPhase = Extract<
  PhaseSnapshotMessage,
  { kind: "video" | "video-position-question" }
>;

export type PhaseVideoProps = {
  sessionId: string | null;
  phase: VideoPhase;
  phaseEpoch: number;
  src: string;
  extraAudioSrc?: string;
  soundEnabled: boolean;
  clock?: ServerClock;
  playbackEnabled?: boolean;
  onVideoElement?: (video: HTMLVideoElement | null) => void;
  onExtraAudioElement?: (audio: HTMLAudioElement | null) => void;
  onFirstFrame?: () => void;
  send: (message: DisplayToServerMessage) => void;
};

export function PhaseVideo({
  sessionId,
  phase,
  phaseEpoch,
  src,
  extraAudioSrc,
  soundEnabled,
  clock,
  playbackEnabled = true,
  onVideoElement,
  onExtraAudioElement,
  onFirstFrame,
  send,
}: PhaseVideoProps) {
  const synchronized = phase.kind === "video" && phase.phoneAudioMode === "synchronized";
  const videoOffsetMs = phase.kind === "video" ? phase.syncVideoOffsetMs ?? 0 : 0;
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopExtraAudio = useRef<(() => void) | null>(null);
  const extraAudioRef = useRef<HTMLAudioElement | null>(null);
  const firstFrameReported = useRef(false);
  const firstFrameCallback = useRef<{ video: HTMLVideoElement; id: number } | null>(null);
  const firstFrameAnimation = useRef<number | null>(null);
  const firstFrameFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnostics = useVideoPlaybackDiagnostics({
    sessionId,
    phaseId: phase.id,
    phaseEpoch,
    mediaId: phase.src,
    videoUrl: src,
    autoPlay: !clock && !synchronized && playbackEnabled,
    send,
  });
  const setVideoRef = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    diagnostics.ref.current = video;
    onVideoElement?.(video);
  }, [diagnostics.ref, onVideoElement]);
  const setExtraAudioRef = useCallback((audio: HTMLAudioElement | null) => {
    extraAudioRef.current = audio;
    onExtraAudioElement?.(audio);
  }, [onExtraAudioElement]);

  const completePhase = useCallback(() => {
    if (sessionId === null) return;
    send({
      t: "video_ended",
      v: PROTOCOL_VERSION,
      sessionId,
      phaseId: phase.id,
      phaseEpoch,
      mediaId: phase.src,
    });
  }, [phase.id, phase.src, phaseEpoch, send, sessionId]);
  useEffect(() => () => {
    if (tailTimer.current !== null) clearTimeout(tailTimer.current);
  }, [completePhase]);
  useEffect(() => {
    firstFrameReported.current = false;
    return () => {
      const callback = firstFrameCallback.current;
      if (callback !== null) {
        callback.video.cancelVideoFrameCallback(callback.id);
      }
      if (firstFrameAnimation.current !== null) {
        cancelAnimationFrame(firstFrameAnimation.current);
      }
      if (firstFrameFallback.current !== null) clearTimeout(firstFrameFallback.current);
      firstFrameCallback.current = null;
      firstFrameAnimation.current = null;
      firstFrameFallback.current = null;
    };
  }, [phaseEpoch, src, playbackEnabled]);
  const handleEnded = () => {
    stopExtraAudio.current?.();
    extraAudioRef.current?.pause();
    const tailDurationMs = clock
      ? Math.max(0, phase.startedAt + phase.expectedDurationMs + Math.max(0, videoOffsetMs) - clock.now())
      : phase.tailDurationMs ?? 0;
    if (tailDurationMs === 0) {
      completePhase();
      return;
    }
    if (tailTimer.current !== null) clearTimeout(tailTimer.current);
    // An ended HTML video remains painted on its final decoded frame while
    // this timer reuses the same visual-tail timing as image + MP3 phases.
    tailTimer.current = setTimeout(() => {
      tailTimer.current = null;
      completePhase();
    }, tailDurationMs);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!clock || !video) return;
    return followMediaClock(video, clock, phase.startedAt + videoOffsetMs, {
      enabled: playbackEnabled,
      ended: handleEnded,
      blocked: diagnostics.onError,
    });
  }, [phase.startedAt, phaseEpoch, src, clock, playbackEnabled, videoOffsetMs]);

  useEffect(() => {
    const audio = extraAudioRef.current;
    if (!clock || !audio) return;
    const stop = followMediaClock(audio, clock, phase.startedAt + videoOffsetMs, {
      enabled: playbackEnabled,
      ended: () => {},
      blocked: diagnostics.onError,
    });
    stopExtraAudio.current = stop;
    return () => { stop(); stopExtraAudio.current = null; };
  }, [phase.startedAt, phaseEpoch, extraAudioSrc, clock, playbackEnabled, videoOffsetMs]);

  const handlePlaying = () => {
    diagnostics.onPlaying();
    const video = videoRef.current;
    if (video !== null && playbackEnabled && !firstFrameReported.current && onFirstFrame !== undefined) {
      firstFrameReported.current = true;
      let revealed = false;
      const reveal = () => {
        if (revealed || videoRef.current !== video) return;
        revealed = true;
        if (firstFrameFallback.current !== null) clearTimeout(firstFrameFallback.current);
        firstFrameFallback.current = null;
        const callback = firstFrameCallback.current;
        if (callback !== null) callback.video.cancelVideoFrameCallback(callback.id);
        firstFrameCallback.current = null;
        if (firstFrameAnimation.current !== null) cancelAnimationFrame(firstFrameAnimation.current);
        firstFrameAnimation.current = null;
        onFirstFrame();
      };
      // A transparent incoming slot can receive `playing` without receiving a
      // compositor callback. Do not make becoming visible depend indefinitely
      // on that callback. Require an actual decoded video frame before fallback.
      const revealDecodedFrame = () => {
        if (firstFrameFallback.current !== null) clearTimeout(firstFrameFallback.current);
        firstFrameFallback.current = null;
        if (videoRef.current !== video || revealed) return;
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
          && !video.seeking && (!video.paused || video.ended)) {
          reveal();
        } else {
          firstFrameFallback.current = setTimeout(revealDecodedFrame, 100);
        }
      };
      firstFrameFallback.current = setTimeout(revealDecodedFrame, 250);
      if (typeof video.requestVideoFrameCallback === "function") {
        const id = video.requestVideoFrameCallback(() => {
          firstFrameCallback.current = null;
          reveal();
        });
        firstFrameCallback.current = { video, id };
      } else {
        // Keep the existing paint-turn fallback for browsers without rVFC.
        firstFrameAnimation.current = requestAnimationFrame(() => {
          firstFrameAnimation.current = null;
          revealDecodedFrame();
        });
      }
    }
    const audio = extraAudioRef.current;
    if (clock || video === null || audio === null) return;
    if (Math.abs(audio.currentTime - video.currentTime) > 0.25) audio.currentTime = video.currentTime;
    const play = audio.play();
    void play?.catch(() => undefined);
  };

  const handleStalled = () => {
    extraAudioRef.current?.pause();
    diagnostics.onStalled();
  };

  return <>
    <video
      ref={setVideoRef}
      src={src}
      autoPlay={!clock && !synchronized && playbackEnabled}
      preload="auto"
      muted={synchronized || !soundEnabled}
      playsInline
      onEnded={clock ? undefined : handleEnded}
      onPlaying={handlePlaying}
      onSeeked={() => {
        const video = videoRef.current;
        if (clock && video && video.paused && Number.isFinite(video.duration)
          && clock.now() >= phase.startedAt + videoOffsetMs + video.duration * 1000) onFirstFrame?.();
      }}
      onStalled={handleStalled}
      onError={diagnostics.onError}
    />
    {!synchronized && extraAudioSrc !== undefined && <audio
      ref={setExtraAudioRef}
      src={extraAudioSrc}
      autoPlay={!clock && playbackEnabled}
      muted={!soundEnabled}
      aria-label="Extra video audio track"
    />}
  </>;
}
