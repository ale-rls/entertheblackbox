import { useEffect, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";
import type { PhaseSnapshotMessage } from "@entertheblackbox/protocol";

/** Rehearsal-only diagnostics, enabled with ?clock=1. */
export function ShowClockOverlay({ clock, phase }: { clock: ServerClock; phase: PhaseSnapshotMessage | null }) {
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(timer); }, []);
  const now = clock.now();
  const elapsed = phase ? (now - phase.startedAt) / 1000 : 0;
  const offset = phase?.kind === "video" ? (phase.syncVideoOffsetMs ?? 0) / 1000 : 0;
  const media = [...document.querySelectorAll<HTMLMediaElement>(".phase-video-slot video, .phase-video-slot audio, .phase-image-audio audio")];
  return <aside style={{ position: "fixed", left: 12, bottom: 12, zIndex: 1000, background: "#000d", color: "white", padding: 12, font: "14px monospace", pointerEvents: "none" }}>
    <div>Server {clock.ready ? new Date(now).toISOString().slice(11, 23) : "waiting"} UTC · {clock.hasSamples ? "measured" : "estimated"}</div>
    <div>Offset {Math.round(clock.offset)} ms · RTT {clock.roundTripMs ?? "—"} ms · age {clock.sampleAgeMs() ?? "—"} ms</div>
    <div>{phase?.id ?? "No cue"} · cue {elapsed.toFixed(2)} s</div>
    {media.map((item, i) => <div key={i}>{item.tagName.toLowerCase()} {item.currentTime.toFixed(2)} s · drift {((item.currentTime - Math.max(0, elapsed - offset)) * 1000).toFixed(0)} ms · {item.seeking ? "seeking" : item.paused ? "paused" : "playing"}</div>)}
  </aside>;
}
