import { useEffect, useRef, useState } from "react";
import { sceneCountdownPings, sceneCountdownSeconds, sceneCountdownText, type SceneCountdown as SceneCountdownConfig } from "@entertheblackbox/scenario";
import type { ServerClock } from "../lib/serverClock.js";
import { VOTE_COUNTDOWN_SOUND_SRC } from "./VoteCloseCountdown.js";

/**
 * Authored countdown on a video or narration scene (e.g. time to build a still image), drawn
 * like the vote-close countdown. Pings once per whole second in its final `pingSeconds`.
 */
export function SceneCountdown({
  countdown,
  startedAt,
  clock,
  soundEnabled,
  belowText = false,
}: {
  countdown: SceneCountdownConfig;
  startedAt: number;
  clock: ServerClock;
  soundEnabled: boolean;
  /** Narration scenes centre their text, so the countdown sits beneath it. */
  belowText?: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(() => clock.now() - startedAt);
  const lastPingSecond = useRef<number | null>(null);
  const ping = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    lastPingSecond.current = null;
    const update = () => setElapsedMs(clock.now() - startedAt);
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [clock, startedAt]);

  const secondsLeft = sceneCountdownSeconds(countdown, elapsedMs);
  const pinging = sceneCountdownPings(countdown, secondsLeft);

  useEffect(() => {
    if (!pinging || !soundEnabled || secondsLeft === null) return;
    if (lastPingSecond.current === secondsLeft) return;
    lastPingSecond.current = secondsLeft;
    const audio = ping.current ?? new Audio(VOTE_COUNTDOWN_SOUND_SRC);
    audio.preload = "auto";
    ping.current = audio;
    audio.pause();
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }, [pinging, secondsLeft, soundEnabled]);

  useEffect(() => () => {
    ping.current?.pause();
    ping.current?.removeAttribute("src");
    ping.current = null;
  }, []);

  const shown = sceneCountdownText(countdown, elapsedMs);
  if (secondsLeft === null || shown === null) return null;
  const amount = countdown.countFrom !== undefined;
  // Keyed by the second so the CSS pulse-in animation restarts on every tick.
  return <div key={secondsLeft} className={`vote-close-countdown scene-countdown${amount ? " countdown-amount" : ""}${belowText ? " scene-countdown-below" : ""}`} aria-live="off">{shown}</div>;
}
