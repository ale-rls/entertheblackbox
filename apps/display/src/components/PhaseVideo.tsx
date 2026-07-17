import {
  PROTOCOL_VERSION,
  type DisplayToServerMessage,
  type PhaseSnapshotMessage,
} from "@smartphonecracy/protocol";

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

  return <video src={src} autoPlay onEnded={handleEnded} />;
}
