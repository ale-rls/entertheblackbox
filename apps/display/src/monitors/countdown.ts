import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";

/** Remaining vote time on the server clock; closed and untimed votes stay quiet. */
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
  } else return null;
  return now < deadline ? Math.ceil((deadline - now) / 1000) : null;
}
