import { useEffect, useState } from "react";
import type {
  PhaseSnapshotMessage,
  QuestionResolvedMessage,
  QuestionStatusMessage,
} from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { QuadrantOverlay } from "./QuadrantOverlay.js";
import { VoteCloseCountdown } from "./VoteCloseCountdown.js";

export type VideoQuestionPhase = Extract<PhaseSnapshotMessage, { kind: "video-position-question" }>;
export type VideoQuestionStage = "hidden" | "shown" | "open" | "closed";

export function videoQuestionStage(phase: VideoQuestionPhase, now: number): VideoQuestionStage {
  const elapsed = now - phase.startedAt;
  if (elapsed < phase.showAtMs || elapsed >= phase.hideAtMs) return "hidden";
  if (elapsed < phase.openAtMs) return "shown";
  if (elapsed < phase.closeAtMs) return "open";
  return "closed";
}

/** Only the statue-picker's polygon zones keep their vote tallies and the "Voting open/closed" pill on screen. */
function showsCountsAndVotingState(fieldType: string): boolean {
  return fieldType === "polygon-zones";
}

export function VideoQuestionOverlay({
  phase,
  clock,
  liveField,
  liveCounts,
  resolution,
  soundEnabled = false,
}: {
  phase: VideoQuestionPhase;
  clock: ServerClock;
  liveField: QuestionStatusMessage["field"] | null;
  liveCounts: NonNullable<QuestionStatusMessage["quadrantCounts"]> | null;
  resolution: QuestionResolvedMessage | null;
  soundEnabled?: boolean;
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
  const keepCountsAndVotingState = showsCountsAndVotingState(phase.field.type);
  const highlightRegionIds = stage === "closed" && resolution !== null
    ? resolution.tieBreak?.candidates
      ?? (resolution.winner === "tie"
        ? Object.keys(resolution.quadrantCounts)
        : resolution.winner === "empty" || resolution.winner === "fixed" ? [] : [resolution.winner])
    : [];

  return (
    <div className="question question-over-video" data-voting-open={votingOpen}>
      <div className="question-copy">
        <p className="question-text">{phase.text}</p>
      </div>
      <QuadrantOverlay
        field={phase.field}
        liveField={liveField}
        liveCounts={liveCounts}
        resolution={resolution}
        showCounts={keepCountsAndVotingState}
        highlightRegionIds={highlightRegionIds}
      />
      {votingOpen && <VoteCloseCountdown clock={clock} deadlineAt={closeAt} soundEnabled={soundEnabled} durationSeconds={phase.closeCountdownSeconds ?? 5} />}
      {keepCountsAndVotingState && <div className="voting-state">{votingState}</div>}
    </div>
  );
}
