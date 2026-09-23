import type { ClockTiming, PhaseSnapshotMessage } from "@entertheblackbox/protocol";
import type { ServerClock } from "@entertheblackbox/shared";
export function readDisplayTiming(clock: ServerClock, phase: PhaseSnapshotMessage | null, main: HTMLMediaElement | null, extra: HTMLMediaElement | null): ClockTiming {
  const elapsedMs = phase ? clock.now() - phase.startedAt : 0;
  const offset = phase?.kind === "video" && phase.audioSrc === undefined ? phase.syncVideoOffsetMs ?? 0 : 0;
  const media: ClockTiming["media"] = [];
  if (phase?.kind === "video" || phase?.kind === "video-position-question") {
    for (const [role, element] of [["main", main], ["extra", extra]] as const) {
      if (!element || !Number.isFinite(element.currentTime)) continue;
      const targetMs = Math.max(0, Math.min(elapsedMs - offset, Number.isFinite(element.duration) ? element.duration * 1000 : Infinity));
      const positionMs = Math.max(0, element.currentTime * 1000);
      const state = element.error ? "error" : element.seeking ? "seeking" : element.readyState < 2 ? "loading"
        : element.ended || (Number.isFinite(element.duration) && elapsedMs - offset >= element.duration * 1000 && element.paused) ? "ended" : element.paused ? "paused" : "playing";
      media.push({ role, positionMs, targetMs, driftMs: positionMs - targetMs, state });
    }
  }
  return { calibrated: clock.hasSamples, offsetMs: clock.offset, roundTripMs: clock.roundTripMs, sampleAgeMs: clock.sampleAgeMs(), elapsedMs, mode: "display", media };
}
