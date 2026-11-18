import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import { activeMonitorCue, type MonitorCue, sceneCountdownSeconds } from "@entertheblackbox/scenario";

/** Remaining vote or scene-countdown time on the server clock; closed and untimed votes stay quiet. */
export function monitorCountdown(phase: PhaseSnapshotMessage | null, now: number): number | null {
  if (!phase) return null;
  let deadline: number;
  if (phase.kind === "position-question") {
    if (phase.deadlineAt === null || now < phase.startedAt) return null;
    deadline = phase.deadlineAt;
  } else if (phase.kind === "video-position-question") {
    const elapsed = now - phase.startedAt;
    if (elapsed < Math.max(phase.showAtMs, phase.openAtMs) || elapsed >= phase.hideAtMs) return null;
    deadline = phase.startedAt + phase.closeAtMs;
  } else if (phase.kind === "video" || phase.kind === "narration") {
    return sceneCountdownSeconds(phase.countdown, now - phase.startedAt);
  } else return null;
  return now < deadline ? Math.ceil((deadline - now) / 1000) : null;
}

/** A cue ends at the earlier of its duration or its replacement; indefinite holds have no deadline. */
export function monitorCueCountdown(cues: readonly MonitorCue[], elapsedMs: number): number | null {
  const cue = activeMonitorCue(cues, elapsedMs);
  if (!cue || cue.kind === "blank" || cue.countdownSeconds === undefined) return null;
  const next = cues.find((item) => item.startMs > cue.startMs);
  const end = Math.min(
    cue.durationMs === undefined ? Infinity : cue.startMs + cue.durationMs,
    next?.startMs ?? Infinity,
  );
  const remaining = end - elapsedMs;
  return Number.isFinite(end) && remaining > 0 && remaining <= cue.countdownSeconds * 1000
    ? Math.ceil(remaining / 1000) : null;
}
