import { useEffect, useState } from "react";
import type { ServerClock } from "../lib/serverClock.js";

/**
 * Countdown rendered from corrected server time (plan §9) — never from
 * the device clock. Re-renders 4×/s, which is enough for whole-second
 * display without burning the kiosk GPU.
 */
export function Countdown({
  clock,
  deadlineAt,
  className,
  minimumSeconds = 0,
}: {
  clock: ServerClock;
  deadlineAt: number;
  className?: string;
  minimumSeconds?: number;
}) {
  const [remainingMs, setRemainingMs] = useState(() =>
    clock.remainingUntil(deadlineAt),
  );

  useEffect(() => {
    const timer = setInterval(
      () => setRemainingMs(clock.remainingUntil(deadlineAt)),
      250,
    );
    return () => clearInterval(timer);
  }, [clock, deadlineAt]);

  return (
    <div className={["countdown", className].filter(Boolean).join(" ")}>
      {Math.max(minimumSeconds, Math.ceil(remainingMs / 1000))}
    </div>
  );
}
