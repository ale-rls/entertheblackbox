import { useEffect, useState } from "react";
import type { PhaseSnapshotMessage } from "@smartphonecracy/protocol";
import type { ServerClock } from "../lib/serverClock.js";

export function formatLobbyCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return [minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function useLobbyRemaining(clock: ServerClock, deadlineAt: number): string {
  const getRemaining = () => formatLobbyCountdown(clock.remainingUntil(deadlineAt));
  const [remaining, setRemaining] = useState(getRemaining);

  useEffect(() => {
    const update = () => setRemaining(getRemaining());
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [clock, deadlineAt]);

  return remaining;
}

function LobbyHeading({ clock, deadlineAt }: { clock: ServerClock; deadlineAt: number | null }) {
  // The countdown hook must run unconditionally (Rules of Hooks), so it
  // always ticks against a real deadline; `clock.now()` is a harmless
  // stand-in for the no-deadline case, whose result is never rendered.
  const remaining = useLobbyRemaining(clock, deadlineAt ?? clock.now());
  if (deadlineAt === null) return <>Join the show</>;
  return <>Show starts in {remaining}</>;
}

export function LobbyCountdown({
  sessionId,
  phase,
  clock,
  joinUrl,
  networkName = "Staedel_WiFi",
}: {
  sessionId: string | null;
  phase: PhaseSnapshotMessage | null;
  clock: ServerClock;
  joinUrl: string | null;
  networkName?: string;
}) {
  if (sessionId !== "lobby" || phase?.kind !== "idle") {
    return null;
  }

  if (phase.deadlineAt === null && joinUrl === null) return null;

  return (
    <div className="lobby-information">
      <h1 className="lobby-heading" aria-live="polite"><LobbyHeading clock={clock} deadlineAt={phase.deadlineAt} /></h1>
      <div className="lobby-instructions">
        <p>Verbinde dich mit dem Besucher-WLAN {networkName} oder nutze dein eigenes mobiles Netz.</p>
        <p>Scanne den QR-Code mit deinem Smartphone und folge den Anleitungen auf deinem Display.</p>
      </div>
      {joinUrl !== null && (
        <div className="lobby-join-url" aria-label="Phone join URL">{joinUrl}</div>
      )}
    </div>
  );
}
