import { useCallback, useEffect, useRef } from "react";
import {
  PROTOCOL_VERSION,
  type DisplayToServerMessage,
  type PhaseSnapshotMessage,
} from "@smartphonecracy/protocol";
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
  soundEnabled: boolean;
  onVideoElement?: (video: HTMLVideoElement | null) => void;
  send: (message: DisplayToServerMessage) => void;
};

export function PhaseVideo({
  sessionId,
  phase,
  phaseEpoch,
  src,
  soundEnabled,
  onVideoElement,
  send,
}: PhaseVideoProps) {
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnostics = useVideoPlaybackDiagnostics({
    sessionId,
    phaseId: phase.id,
    phaseEpoch,
    mediaId: phase.src,
    videoUrl: src,
    send,
  });
  const setVideoRef = useCallback((video: HTMLVideoElement | null) => {
    diagnostics.ref.current = video;
    onVideoElement?.(video);
  }, [diagnostics.ref, onVideoElement]);

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
  const handleEnded = () => {
    const tailDurationMs = phase.tailDurationMs ?? 0;
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

  return (
    <video
      ref={setVideoRef}
      src={src}
      autoPlay
      muted={!soundEnabled}
      playsInline
      onEnded={handleEnded}
      onPlaying={diagnostics.onPlaying}
      onStalled={diagnostics.onStalled}
      onError={diagnostics.onError}
    />
  );
}
