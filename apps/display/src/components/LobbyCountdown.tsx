import { useEffect, useState } from "react";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";

const FINAL_COUNTDOWN_SECONDS = 10;

function FinalCountdown({ clock, deadlineAt }: { clock: ServerClock; deadlineAt: number }) {
  const getSeconds = () => Math.ceil(clock.remainingUntil(deadlineAt) / 1_000);
  const [seconds, setSeconds] = useState(getSeconds);

  useEffect(() => {
    const update = () => setSeconds(getSeconds());
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [clock, deadlineAt]);

  if (seconds > FINAL_COUNTDOWN_SECONDS) return null;

  return (
    <div className="lobby-final-countdown" aria-live="polite">
      <strong>{seconds}</strong>
      <span>seconds</span>
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
        <div className="lobby-start-time">
          <span>Show starts at</span>
          <time dateTime={new Date(phase.deadlineAt).toISOString()}>
            {new Date(phase.deadlineAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </time>
          <FinalCountdown clock={clock} deadlineAt={phase.deadlineAt} />
        </div>
      )}
      {joinUrl !== null && (
        <div className="lobby-join-url" aria-label="Phone join URL">{joinUrl}</div>
      )}
    </div>
  );
}
