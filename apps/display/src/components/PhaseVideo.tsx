import {
  PROTOCOL_VERSION,
  type DisplayToServerMessage,
  type PhaseSnapshotMessage,
} from "@smartphonecracy/protocol";
import { useVideoPlaybackDiagnostics } from "../media/useVideoPlaybackDiagnostics.js";

type VideoPhase = Extract<PhaseSnapshotMessage, { kind: "video" }>;

export type PhaseVideoProps = {
  sessionId: string | null;
  phase: VideoPhase;
  phaseEpoch: number;
  src: string;
  send: (message: DisplayToServerMessage) => void;
};

export function PhaseVideo({
  sessionId,
  phase,
  phaseEpoch,
  src,
  send,
}: PhaseVideoProps) {
  const diagnostics = useVideoPlaybackDiagnostics({
    sessionId,
    phaseId: phase.id,
    phaseEpoch,
    mediaId: phase.src,
    videoUrl: src,
    send,
  });

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

  return (
    <video
      ref={diagnostics.ref}
      src={src}
      autoPlay
      muted
      onEnded={handleEnded}
      onPlaying={diagnostics.onPlaying}
      onStalled={diagnostics.onStalled}
      onError={diagnostics.onError}
    />
  );
}
