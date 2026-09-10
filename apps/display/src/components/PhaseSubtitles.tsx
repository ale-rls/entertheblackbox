import { useEffect, useState } from "react";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";

type MediaPhase = Extract<PhaseSnapshotMessage, { kind: "video" | "video-position-question" }>;

export function PhaseSubtitles({ phase, clock }: { phase: MediaPhase; clock: ServerClock }) {
  const [elapsed, setElapsed] = useState(() => clock.now() - phase.startedAt);
  useEffect(() => {
    const update = () => setElapsed(clock.now() - phase.startedAt);
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [clock, phase.id, phase.startedAt]);
  const active = phase.subtitles?.filter((entry) => elapsed >= entry.startAtMs && elapsed < entry.endAtMs) ?? [];
  if (active.length === 0) return null;
  return <div className="phase-subtitles" aria-live="polite">{active.map((entry, index) => <p key={`${entry.startAtMs}-${entry.endAtMs}-${index}`}>{entry.text}</p>)}</div>;
}
