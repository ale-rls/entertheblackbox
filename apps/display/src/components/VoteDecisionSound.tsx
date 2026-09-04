import { useEffect, useRef } from "react";
import type { QuestionResolvedMessage } from "@smartphonecracy/protocol";

export const VOTE_DECISION_SOUND_SRC = "/display/sfx/please%20cut%20me%20only%20the%20beginning%207%20seconds.mp3";
export const VOTE_DECISION_SOUND_DURATION_MS = 7_000;
export const SPECTRUM_DECISION_SOUND_SRC = "/display/sfx/Ping4.mp3";
export const SPECTRUM_DECISION_PLAYBACK_RATE = 0.9;

function isSpectrumResolution(resolution: QuestionResolvedMessage): boolean {
  return resolution.field.type === "four-quadrant"
    || (resolution.field.type === "two-quadrant" && resolution.field.variant === "spectrum");
}

/** Plays the requested decision sting once, capped at its first seven seconds. */
export function VoteDecisionSound({
  resolution,
  soundEnabled,
}: {
  resolution: QuestionResolvedMessage | null;
  soundEnabled: boolean;
}) {
  const seenResolution = useRef<string | null>(null);

  useEffect(() => {
    if (resolution === null) {
      seenResolution.current = null;
      return;
    }

    const key = `${resolution.sessionId}:${resolution.phaseEpoch}`;
    if (seenResolution.current === key) return;
    seenResolution.current = key;
    if (!soundEnabled) return;

    const spectrumResolution = isSpectrumResolution(resolution);
    const audio = new Audio(spectrumResolution ? SPECTRUM_DECISION_SOUND_SRC : VOTE_DECISION_SOUND_SRC);
    audio.preload = "auto";
    if (spectrumResolution) {
      // Let the slower playback lower Ping4's pitch instead of time-stretching
      // it back to the original pitch.
      audio.preservesPitch = false;
      audio.playbackRate = SPECTRUM_DECISION_PLAYBACK_RATE;
    }
    const stop = () => {
      audio.pause();
      audio.removeAttribute("src");
    };
    const timer = window.setTimeout(stop, VOTE_DECISION_SOUND_DURATION_MS);
    audio.addEventListener("ended", () => window.clearTimeout(timer), { once: true });
    void audio.play().catch(() => {
      window.clearTimeout(timer);
      stop();
    });

    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [resolution, soundEnabled]);

  return null;
}
