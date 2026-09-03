import { useEffect, useRef, useState } from "react";
import type { ServerClock } from "../lib/serverClock.js";

/** How many seconds before the deadline the dramatic center countdown takes over. */
export const DEFAULT_VOTE_CLOSE_COUNTDOWN_SECONDS = 5;

export const VOTE_COUNTDOWN_SOUND_SRC = "/display/sfx/Ping4.mp3";

/**
 * Dramatic centered countdown for the final seconds before a vote closes.
 * Stays hidden until inside the countdown window (parent should stop
 * rendering the small corner Countdown at that point) and beeps once per
 * whole second while sound is enabled.
 */
export function VoteCloseCountdown({
  clock,
  deadlineAt,
  soundEnabled,
  durationSeconds = DEFAULT_VOTE_CLOSE_COUNTDOWN_SECONDS,
  center,
}: {
  clock: ServerClock;
  deadlineAt: number;
  soundEnabled: boolean;
  durationSeconds?: 5 | 10;
  /** Arena center (0-100 percentages) to align on instead of the screen center. */
  center?: { x: number; y: number } | null;
}) {
  const [remainingMs, setRemainingMs] = useState(() => clock.remainingUntil(deadlineAt));
  const lastBeepSecond = useRef<number | null>(null);
  const ping = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    lastBeepSecond.current = null;
    const update = () => setRemainingMs(clock.remainingUntil(deadlineAt));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [clock, deadlineAt]);

  const secondsLeft = Math.ceil(remainingMs / 1000);
  const inFinalCountdown = remainingMs > 0 && secondsLeft <= durationSeconds;

  useEffect(() => {
    if (!inFinalCountdown || !soundEnabled) return;
    if (lastBeepSecond.current === secondsLeft) return;
    lastBeepSecond.current = secondsLeft;
    const audio = ping.current ?? new Audio(VOTE_COUNTDOWN_SOUND_SRC);
    audio.preload = "auto";
    ping.current = audio;
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }, [inFinalCountdown, secondsLeft, soundEnabled]);

  useEffect(() => () => {
    ping.current?.pause();
    ping.current?.removeAttribute("src");
    ping.current = null;
  }, []);

  if (!inFinalCountdown) return null;

  const style = center ? { left: `${center.x}%`, top: `${center.y}%` } : undefined;

  // Keyed by the second so the CSS pulse-in animation restarts on every tick.
  return <div key={secondsLeft} className="vote-close-countdown" style={style}>{secondsLeft}</div>;
}

/** True during the final countdown window -- lets a parent decide when to blink the leading side. */
export function isInVoteCloseWindow(remainingMs: number, durationSeconds = DEFAULT_VOTE_CLOSE_COUNTDOWN_SECONDS): boolean {
  return remainingMs > 0 && Math.ceil(remainingMs / 1000) <= durationSeconds;
}
