import { useEffect, useState } from "react";
import { voteCountdownSeconds } from "@entertheblackbox/scenario";
import type {
  PhaseSnapshotMessage,
  QuestionResolvedMessage,
  QuestionStatusMessage,
} from "@entertheblackbox/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { QuadrantOverlay, questionFieldCenter, tiedLeaders } from "./QuadrantOverlay.js";
import { VoteCloseCountdown } from "./VoteCloseCountdown.js";
import { VideoTitle } from "./VideoTitle.js";

export type VideoQuestionPhase = Extract<PhaseSnapshotMessage, { kind: "video-position-question" }>;
export type VideoQuestionStage = "hidden" | "shown" | "open" | "closed";

/**
 * A question that stays up until its scene ends waits this long past the end
 * before fading, so a following scene that asks the same question can take it
 * over without the overlay blinking.
 */
export const SCENE_END_HANDOVER_MS = 500;

/** The next scene asks the same question on the same field: the overlay carries straight on. */
export function continuesQuestion(previous: VideoQuestionPhase, next: VideoQuestionPhase): boolean {
  return previous.hideAtMs >= previous.expectedDurationMs
    && previous.text === next.text
    && JSON.stringify(previous.field) === JSON.stringify(next.field);
}

/**
 * `continued`: the question was already on screen from the scene before, so
 * the lead-in before `showAtMs` keeps it shown instead of hiding it.
 */
export function videoQuestionStage(phase: VideoQuestionPhase, now: number, continued = false): VideoQuestionStage {
  const elapsed = now - phase.startedAt;
  const hideAt = phase.hideAtMs >= phase.expectedDurationMs ? phase.hideAtMs + SCENE_END_HANDOVER_MS : phase.hideAtMs;
  if ((elapsed < phase.showAtMs && !continued) || elapsed >= hideAt) return "hidden";
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
  soundEnabled = false,
  bare = false,
}: {
  phase: VideoQuestionPhase;
  clock: ServerClock;
  liveField: QuestionStatusMessage["field"] | null;
  liveCounts: NonNullable<QuestionStatusMessage["quadrantCounts"]> | null;
  resolution: QuestionResolvedMessage | null;
  soundEnabled?: boolean;
  /** Curtain-light votes draw the question and answers in the lit curtain; keep only the timing UI. */
  bare?: boolean;
}) {
  const [now, setNow] = useState(() => clock.now());

  useEffect(() => {
    const update = () => setNow(clock.now());
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [clock, phase.id, phase.startedAt]);

  // Consecutive scenes asking the same question keep one overlay on screen. The
  // previous scene is remembered here (this component stays mounted across them).
  const phaseKey = `${phase.id}:${phase.startedAt}`;
  const [scene, setScene] = useState({ key: phaseKey, phase, continued: false });
  const continued = scene.key === phaseKey ? scene.continued : continuesQuestion(scene.phase, phase);
  if (scene.key !== phaseKey) setScene({ key: phaseKey, phase, continued });

  const closeAt = phase.startedAt + phase.closeAtMs;
  const elapsed = now - phase.startedAt;
  const stage = videoQuestionStage(phase, now, continued);

  // The overlay's own div fades out (CSS `question-out` animation) once
  // `stage` goes "hidden" instead of vanishing instantly, so unmounting is
  // deferred to the animation's end rather than to this render.
  const [rendered, setRendered] = useState(stage !== "hidden");
  useEffect(() => {
    if (stage !== "hidden") setRendered(true);
  }, [stage]);

  // While fading out, keep rendering the last non-hidden stage's content
  // (highlights and labels) so only opacity changes -- the
  // underlying values would otherwise snap away the instant `stage` flips.
  const [displayStage, setDisplayStage] = useState(stage);
  useEffect(() => {
    if (stage !== "hidden") setDisplayStage(stage);
  }, [stage]);

  if (elapsed < phase.showAtMs && phase.title && !continued) {
    return <VideoTitle title={phase.title} layout={undefined} />;
  }

  if (stage === "hidden" && !rendered) return null;

  const fadingOut = stage === "hidden";
  const votingOpen = displayStage === "open" && resolution === null;
  const highlightRegionIds = displayStage === "closed" && resolution !== null
    ? resolution.tieBreak?.candidates
      ?? (resolution.winner === "tie"
        ? tiedLeaders(resolution.quadrantCounts)
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
      {!bare && <div className="question-copy">
        <p className="question-text">{phase.text}</p>
      </div>}
      {!bare && <QuadrantOverlay
        field={phase.field}
        liveField={liveField}
        liveCounts={liveCounts}
        resolution={resolution}
        showCounts={false}
        highlightRegionIds={highlightRegionIds}
      />}
      {votingOpen && <VoteCloseCountdown clock={clock} deadlineAt={closeAt} soundEnabled={soundEnabled} durationSeconds={voteCountdownSeconds(phase)} center={bare ? null : questionFieldCenter(phase.field)} />}
    </div>
  );
}
