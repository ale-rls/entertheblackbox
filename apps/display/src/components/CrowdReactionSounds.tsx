import { useEffect, useRef } from "react";
import type { RatingStatusMessage } from "@smartphonecracy/protocol";

export const CROWD_REACTION_SAMPLES = {
  applause: [
    "/display/sfx/crowd-applause-01.mp3",
    "/display/sfx/crowd-applause-02.mp3",
    "/display/sfx/crowd-applause-03.mp3",
  ],
  boo: [
    "/display/sfx/crowd-boo-01.mp3",
    "/display/sfx/crowd-boo-02.mp3",
    "/display/sfx/crowd-boo-03.mp3",
  ],
} as const;

const REACTION_THROTTLE_MS = 1_200;

type ReactionKind = keyof typeof CROWD_REACTION_SAMPLES;

export function pickReactionSample(kind: ReactionKind, random = Math.random): string {
  const samples = CROWD_REACTION_SAMPLES[kind];
  return samples[Math.min(samples.length - 1, Math.floor(random() * samples.length))]!;
}

function reactionVolume(newReactions: number): number {
  return Math.min(1, 0.48 + Math.log2(newReactions + 1) * 0.14);
}

/**
 * Turns cumulative server reaction counters into short, varied crowd sounds.
 * Nothing is rendered: the display should feel the room's response rather
 * than present applause and boos as a competitive numeric score.
 */
export function CrowdReactionSounds({
  status,
  soundEnabled,
  windows,
  elapsedMs = 0,
}: {
  status: RatingStatusMessage | null;
  soundEnabled: boolean;
  windows?: readonly { startAtMs: number; endAtMs: number }[];
  elapsedMs?: number;
}) {
  const previous = useRef<RatingStatusMessage | null>(null);
  const activeAudio = useRef(new Set<HTMLAudioElement>());
  const lastPlayedAt = useRef<Record<ReactionKind, number>>({ applause: -Infinity, boo: -Infinity });

  useEffect(() => () => {
    for (const audio of activeAudio.current) {
      audio.pause();
      audio.removeAttribute("src");
    }
    activeAudio.current.clear();
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (status === null) return;
    if (
      before === null
      || before.sessionId !== status.sessionId
      || before.phaseEpoch !== status.phaseEpoch
    ) return;

    const deltas = {
      applause: Math.max(0, status.applause - before.applause),
      boo: Math.max(0, status.boo - before.boo),
    };
    const insideWindow = windows === undefined || windows.some((window) => elapsedMs >= window.startAtMs && elapsedMs < window.endAtMs);
    if (!soundEnabled || !insideWindow) return;

    for (const kind of ["applause", "boo"] as const) {
      const delta = deltas[kind];
      if (delta === 0) continue;
      const now = Date.now();
      if (now - lastPlayedAt.current[kind] < REACTION_THROTTLE_MS) continue;
      lastPlayedAt.current[kind] = now;
      const audio = new Audio(pickReactionSample(kind));
      audio.preload = "auto";
      audio.volume = reactionVolume(delta);
      activeAudio.current.add(audio);
      const release = () => activeAudio.current.delete(audio);
      audio.addEventListener("ended", release, { once: true });
      audio.addEventListener("error", release, { once: true });
      void audio.play().catch(release);
    }
  }, [elapsedMs, soundEnabled, status, windows]);

  return null;
}
