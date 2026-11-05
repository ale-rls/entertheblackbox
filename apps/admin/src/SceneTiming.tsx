import { useEffect, useState } from "react";
import type { ServerClock } from "@entertheblackbox/shared";

/** Uses the synchronized clock; a missing deadline is not an estimated duration. */
export function SceneTiming({ clock, startedAt, deadlineAt, stale, finished = false }: {
  clock: ServerClock; startedAt?: number | undefined; deadlineAt?: number | null | undefined; stale: boolean; finished?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  if (finished) return <p className="admin-scene-timing">Waiting at reunion</p>;
  if (stale || !clock.ready || startedAt === undefined) return <p className="sc-tool-help">{stale ? "Timing unavailable — updates stale" : "Awaiting timing"}</p>;
  const seconds = Math.floor(Math.max(0, deadlineAt == null ? clock.now(now) - startedAt : deadlineAt - clock.now(now)) / 1000);
  return <div className="admin-scene-timing"><strong>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</strong><span>{deadlineAt == null ? "elapsed · no deadline reported" : seconds === 0 ? "Awaiting server transition" : "until scheduled scene deadline"}</span></div>;
}
