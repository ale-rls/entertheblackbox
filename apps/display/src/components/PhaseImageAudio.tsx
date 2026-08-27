import { useCallback } from "react";
import {
  PROTOCOL_VERSION,
  type DisplayToServerMessage,
  type PhaseSnapshotMessage,
} from "@smartphonecracy/protocol";
import { useVideoPlaybackDiagnostics } from "../media/useVideoPlaybackDiagnostics.js";

type ImageAudioPhase = Extract<PhaseSnapshotMessage, { kind: "video" | "video-position-question" }> & { audioSrc: string };

export function PhaseImageAudio({
  sessionId,
  phase,
  phaseEpoch,
  imageSrc,
  audioSrc,
  soundEnabled,
  onAudioElement,
  send,
}: {
  sessionId: string | null;
  phase: ImageAudioPhase;
  phaseEpoch: number;
  imageSrc: string;
  audioSrc: string;
  soundEnabled: boolean;
  onAudioElement?: (audio: HTMLAudioElement | null) => void;
  send: (message: DisplayToServerMessage) => void;
}) {
  const diagnostics = useVideoPlaybackDiagnostics({
    sessionId,
    phaseId: phase.id,
    phaseEpoch,
    mediaId: phase.src,
    videoUrl: audioSrc,
    send,
  });
  const setAudioRef = useCallback((audio: HTMLAudioElement | null) => {
    diagnostics.ref.current = audio;
    onAudioElement?.(audio);
  }, [diagnostics.ref, onAudioElement]);
  const handleEnded = () => {
    if (sessionId === null) return;
    send({
      t: "video_ended",
      v: PROTOCOL_VERSION,
      sessionId,
      phaseId: phase.id,
      phaseEpoch,
      mediaId: phase.src,
    });
  };

  return <div className="phase-image-audio">
    <img src={imageSrc} alt="" />
    <audio
      ref={setAudioRef}
      src={audioSrc}
      autoPlay
      muted={!soundEnabled}
      onEnded={handleEnded}
      onPlaying={diagnostics.onPlaying}
      onStalled={diagnostics.onStalled}
      onError={diagnostics.onError}
    />
  </div>;
}
