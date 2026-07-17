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
    <Countdown
      clock={clock}
      deadlineAt={phase.deadlineAt}
      className="countdown-lobby"
      minimumSeconds={1}
    />
  );
}
