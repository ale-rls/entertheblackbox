import { useEffect, useState } from "react";
import type {
  PhaseSnapshotMessage,
  QuestionResolvedMessage,
  QuestionStatusMessage,
} from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { Countdown } from "./Countdown.js";
import { QuadrantOverlay } from "./QuadrantOverlay.js";

export type VideoQuestionPhase = Extract<PhaseSnapshotMessage, { kind: "video-position-question" }>;
export type VideoQuestionStage = "hidden" | "shown" | "open" | "closed";

export function videoQuestionStage(phase: VideoQuestionPhase, now: number): VideoQuestionStage {
  const elapsed = now - phase.startedAt;
  if (elapsed < phase.showAtMs || elapsed >= phase.hideAtMs) return "hidden";
  if (elapsed < phase.openAtMs) return "shown";
  if (elapsed < phase.closeAtMs) return "open";
  return "closed";
}

export function VideoQuestionOverlay({
  phase,
  clock,
  liveField,
  liveCounts,
  resolution,
}: {
  phase: VideoQuestionPhase;
  clock: ServerClock;
  liveField: QuestionStatusMessage["field"] | null;
  liveCounts: NonNullable<QuestionStatusMessage["quadrantCounts"]> | null;
  resolution: QuestionResolvedMessage | null;
}) {
  const [now, setNow] = useState(() => clock.now());

  useEffect(() => {
    const update = () => setNow(clock.now());
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [clock, phase.id, phase.startedAt]);

  const closeAt = phase.startedAt + phase.closeAtMs;
  const stage = videoQuestionStage(phase, now);
  if (stage === "hidden") return null;

  const votingOpen = stage === "open" && resolution === null;
  const votingState = stage === "shown"
    ? "Voting opens soon"
    : votingOpen
      ? "Voting open"
      : "Voting closed";
  return (
    <div className="question question-over-video" data-voting-open={votingOpen}>
      <div className="question-scrim" />
      <div className="question-copy">
        <p className="question-text">{phase.text}</p>
      </div>
      <QuadrantOverlay
        field={phase.field}
        liveField={liveField}
        liveCounts={liveCounts}
        resolution={resolution}
      />
      {votingOpen && <Countdown clock={clock} deadlineAt={closeAt} />}
      <div className="voting-state">{votingState}</div>
    </div>
  );
}
