import { activeMonitorCue, MONITOR_IDS, type MonitorCue, type MonitorCues } from "./monitors.js";
import { sceneCountdownSeconds, type SceneCountdown } from "./scene-countdown.js";

/**
 * What the M1–M4 monitors count down, shared by the monitor display and the
 * native app (which plays it as ticks). Pure: callers pass the server clock.
 */

/** Automatic vote and scene countdowns appear on the monitors only for their final seconds. */
export const MONITOR_FINAL_COUNTDOWN_SECONDS = 5;

/** The phase fields a monitor countdown reads; phase snapshots satisfy it. */
export type MonitorCountdownPhase = {
  kind: string;
  startedAt: number;
  deadlineAt?: number | null | undefined;
  showAtMs?: number | undefined;
  openAtMs?: number | undefined;
  closeAtMs?: number | undefined;
  hideAtMs?: number | undefined;
  countdown?: SceneCountdown | undefined;
  monitorCues?: MonitorCues | undefined;
};

/**
 * Only text-bearing cues count down: the number replaces the text, centred and
 * in its colour. Image and video cues (for example a scale) never show one, so
 * on split screens the opposing question monitors carry the countdown.
 */
export function monitorCueShowsCountdown(cue: MonitorCue | null): cue is Extract<MonitorCue, { kind: "text" | "vote-result" | "placeholder" }> {
  return cue?.kind === "text" || cue?.kind === "vote-result" || cue?.kind === "placeholder";
}

/** Clamps an automatic countdown to its final seconds; earlier seconds keep the text. */
export function finalMonitorCountdown(seconds: number | null): number | null {
  return seconds !== null && seconds <= MONITOR_FINAL_COUNTDOWN_SECONDS ? seconds : null;
}

/** Remaining vote or scene-countdown time on the server clock; closed and untimed votes stay quiet. */
export function monitorCountdown(phase: MonitorCountdownPhase | null, now: number): number | null {
  if (!phase) return null;
  let deadline: number;
  if (phase.kind === "position-question") {
    if (phase.deadlineAt == null || now < phase.startedAt) return null;
    deadline = phase.deadlineAt;
  } else if (phase.kind === "video-position-question") {
    const elapsed = now - phase.startedAt;
    if (elapsed < Math.max(phase.showAtMs ?? 0, phase.openAtMs ?? 0) || elapsed >= (phase.hideAtMs ?? 0)) return null;
    deadline = phase.startedAt + (phase.closeAtMs ?? 0);
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

/**
 * The number one monitor shows now, or null. An authored per-cue countdown
 * keeps its own length; vote and scene countdowns only show their final
 * seconds, and none once the vote has resolved.
 */
export function shownMonitorCountdown(cues: readonly MonitorCue[], phase: MonitorCountdownPhase | null, now: number, resolved = false): number | null {
  if (!phase) return null;
  const cue = activeMonitorCue(cues, now - phase.startedAt);
  if (!monitorCueShowsCountdown(cue)) return null;
  if (cue.countdownSeconds !== undefined) return monitorCueCountdown(cues, now - phase.startedAt);
  return resolved ? null : finalMonitorCountdown(monitorCountdown(phase, now));
}

/** The highest number any of M1–M4 shows now, or null when no monitor counts down. */
export function anyMonitorCountdown(phase: MonitorCountdownPhase | null, now: number, resolved = false): number | null {
  let shown: number | null = null;
  for (const id of MONITOR_IDS) {
    const seconds = shownMonitorCountdown(phase?.monitorCues?.[id] ?? [], phase, now, resolved);
    if (seconds !== null && (shown === null || seconds > shown)) shown = seconds;
  }
  return shown;
}
