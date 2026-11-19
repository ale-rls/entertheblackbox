import type { MonitorCue } from "@entertheblackbox/scenario";

/** Finite videos hold their last frame; loops wrap on the server clock. */
export function monitorVideoTime(elapsedMs: number, durationSeconds: number, loop: boolean): { time: number; playing: boolean } {
  if (elapsedMs < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return { time: 0, playing: false };
  const seconds = elapsedMs / 1000;
  return loop ? { time: seconds % durationSeconds, playing: true }
    : { time: Math.min(seconds, Math.max(0, durationSeconds - 0.001)), playing: seconds < durationSeconds };
}

/** Bound the outgoing hold if the incoming decoder stalls. */
export const MONITOR_CUT_HOLD_MS = 500;

export function isAdjacentMonitorVideoCut(
  cues: readonly MonitorCue[], previousStartMs: number, next: MonitorCue | null, elapsedMs: number,
): boolean {
  if (next?.kind !== "video" || elapsedMs < next.startMs || elapsedMs >= next.startMs + MONITOR_CUT_HOLD_MS) return false;
  const previous = cues[cues.indexOf(next) - 1];
  return previous?.kind === "video" && previous.startMs === previousStartMs &&
    (previous.durationMs === undefined || previous.startMs + previous.durationMs >= next.startMs);
}
