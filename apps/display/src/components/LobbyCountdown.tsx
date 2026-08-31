import { useEffect, useState } from "react";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";

export function formatLobbyCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function LobbyClock({ clock, deadlineAt }: { clock: ServerClock; deadlineAt: number }) {
  const getRemaining = () => formatLobbyCountdown(clock.remainingUntil(deadlineAt));
  const [remaining, setRemaining] = useState(getRemaining);

  useEffect(() => {
    const update = () => setRemaining(getRemaining());
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [clock, deadlineAt]);

  return (
    <div className="lobby-countdown" aria-label="Time until show starts" aria-live="polite">
      {remaining}
    </div>
  );
}

export function LobbyCountdown({
  sessionId,
  phase,
  clock,
  joinUrl,
}: {
  sessionId: string | null;
  phase: PhaseSnapshotMessage | null;
  clock: ServerClock;
  joinUrl: string | null;
}) {
  if (sessionId !== "lobby" || phase?.kind !== "idle") {
    return null;
  }

  if (phase.deadlineAt === null && joinUrl === null) return null;

  return (
    <div className="lobby-information">
      {phase.deadlineAt !== null && (
        <LobbyClock clock={clock} deadlineAt={phase.deadlineAt} />
      )}
      {joinUrl !== null && (
        <div className="lobby-join-url" aria-label="Phone join URL">{joinUrl}</div>
      )}
    </div>
  );
}
