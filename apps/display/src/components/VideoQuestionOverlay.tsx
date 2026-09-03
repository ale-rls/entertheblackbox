import { useEffect, useState } from "react";
import type {
  PhaseSnapshotMessage,
  QuestionResolvedMessage,
  QuestionStatusMessage,
} from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { QuadrantOverlay, questionFieldCenter } from "./QuadrantOverlay.js";
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

/** Only the statue-picker's polygon zones keep their vote tallies on screen. */
function showsCounts(fieldType: string): boolean {
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

  // The overlay's own div fades out (CSS `question-out` animation) once
  // `stage` goes "hidden" instead of vanishing instantly, so unmounting is
  // deferred to the animation's end rather than to this render.
  const [rendered, setRendered] = useState(stage !== "hidden");
  useEffect(() => {
    if (stage !== "hidden") setRendered(true);
  }, [stage]);

  // While fading out, keep rendering the last non-hidden stage's content
  // (counts and highlights) so only opacity changes -- the
  // underlying values would otherwise snap away the instant `stage` flips.
  const [displayStage, setDisplayStage] = useState(stage);
  useEffect(() => {
    if (stage !== "hidden") setDisplayStage(stage);
  }, [stage]);

  if (stage === "hidden" && !rendered) return null;

  const fadingOut = stage === "hidden";
  const votingOpen = displayStage === "open" && resolution === null;
  const keepCounts = showsCounts(phase.field.type);
  const highlightRegionIds = displayStage === "closed" && resolution !== null
    ? resolution.tieBreak?.candidates
      ?? (resolution.winner === "tie"
        ? Object.keys(resolution.quadrantCounts)
        : resolution.winner === "empty" || resolution.winner === "fixed" ? [] : [resolution.winner])
    : [];

  return (
    <div
      className={`question question-over-video${fadingOut ? " question-fade-out" : ""}`}
      data-voting-open={votingOpen}
      onAnimationEnd={(event) => {
        if (fadingOut && event.animationName === "question-out") setRendered(false);
      }}
    >
      <div className="question-copy">
        <p className="question-text">{phase.text}</p>
      </div>
      <QuadrantOverlay
        field={phase.field}
        liveField={liveField}
        liveCounts={liveCounts}
        resolution={resolution}
        showCounts={keepCounts}
        highlightRegionIds={highlightRegionIds}
      />
      {votingOpen && <VoteCloseCountdown clock={clock} deadlineAt={closeAt} soundEnabled={soundEnabled} durationSeconds={phase.closeCountdownSeconds ?? 5} center={questionFieldCenter(phase.field)} />}
    </div>
  );
}
