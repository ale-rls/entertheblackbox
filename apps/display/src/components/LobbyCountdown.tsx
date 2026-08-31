import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";
import { Countdown } from "./Countdown.js";

export function LobbyCountdown({
  sessionId,
  phase,
  clock,
}: {
  sessionId: string | null;
  phase: PhaseSnapshotMessage | null;
  clock: ServerClock;
}) {
  if (sessionId !== "lobby" || phase?.kind !== "idle" || phase.deadlineAt === null) {
    return null;
  }

  return (
    <div className="lobby-start-time">
      <span>Show starts at</span>
      <time dateTime={new Date(phase.deadlineAt).toISOString()}>
        {new Date(phase.deadlineAt).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" })}
      </time>
      <Countdown
        clock={clock}
        deadlineAt={phase.deadlineAt}
        className="countdown-lobby"
        minimumSeconds={1}
      />
      <small>seconds</small>
    </div>
  );
}
