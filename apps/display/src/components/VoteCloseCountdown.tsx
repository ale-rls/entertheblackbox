import { useEffect, useRef, useState } from "react";
import type { ServerClock } from "../lib/serverClock.js";

/** How many seconds before the deadline the dramatic center countdown takes over. */
export const VOTE_CLOSE_COUNTDOWN_SECONDS = 3;

const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_S = 0.12;

type AudioContextCtor = typeof AudioContext;

// A single shared context: creating one per beep would hit the browser's
// concurrent-context limits, and each kiosk tab only ever needs one.
let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (Ctor === undefined) return null;
  if (sharedAudioContext === null) sharedAudioContext = new Ctor();
  return sharedAudioContext;
}

/** Short synthesized tick -- no bundled asset fits a generic countdown beep. */
function playBeep(): void {
  const ctx = getAudioContext();
  if (ctx === null) return;
  void ctx.resume().catch(() => {});
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = BEEP_FREQUENCY_HZ;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + BEEP_DURATION_S);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + BEEP_DURATION_S + 0.02);
}

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
}: {
  clock: ServerClock;
  deadlineAt: number;
  soundEnabled: boolean;
}) {
  const [remainingMs, setRemainingMs] = useState(() => clock.remainingUntil(deadlineAt));
  const lastBeepSecond = useRef<number | null>(null);

  useEffect(() => {
    lastBeepSecond.current = null;
    const update = () => setRemainingMs(clock.remainingUntil(deadlineAt));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [clock, deadlineAt]);

  const secondsLeft = Math.ceil(remainingMs / 1000);
  const inFinalCountdown = remainingMs > 0 && secondsLeft <= VOTE_CLOSE_COUNTDOWN_SECONDS;

  useEffect(() => {
    if (!inFinalCountdown || !soundEnabled) return;
    if (lastBeepSecond.current === secondsLeft) return;
    lastBeepSecond.current = secondsLeft;
    playBeep();
  }, [inFinalCountdown, secondsLeft, soundEnabled]);

  if (!inFinalCountdown) return null;

  // Keyed by the second so the CSS pulse-in animation restarts on every tick.
  return <div key={secondsLeft} className="vote-close-countdown">{secondsLeft}</div>;
}

/** True during the final countdown window -- lets a parent decide when to blink the leading side. */
export function isInVoteCloseWindow(remainingMs: number): boolean {
  return remainingMs > 0 && Math.ceil(remainingMs / 1000) <= VOTE_CLOSE_COUNTDOWN_SECONDS;
}
