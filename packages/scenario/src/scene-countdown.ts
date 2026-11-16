import { z } from "zod";

/**
 * A visible countdown on a video or narration scene, on the scene timeline (ms from scene start):
 * e.g. "30 seconds to build the still image". The final `pingSeconds` tick audibly on the display.
 */
export const sceneCountdownSchema = z.object({
  startAtMs: z.number().int().nonnegative(),
  endAtMs: z.number().int().positive(),
  pingSeconds: z.number().int().min(0).max(60).optional(),
}).refine((countdown) => countdown.startAtMs < countdown.endAtMs, {
  message: "countdown start must be before its end",
  path: ["startAtMs"],
});

export type SceneCountdown = z.infer<typeof sceneCountdownSchema>;

/** Whole seconds left at `elapsedMs` into the scene, or null outside the countdown. */
export function sceneCountdownSeconds(countdown: SceneCountdown | undefined, elapsedMs: number): number | null {
  if (!countdown || elapsedMs < countdown.startAtMs || elapsedMs >= countdown.endAtMs) return null;
  return Math.ceil((countdown.endAtMs - elapsedMs) / 1000);
}

/** True while the countdown should ping once per second. */
export function sceneCountdownPings(countdown: SceneCountdown | undefined, secondsLeft: number | null): boolean {
  return secondsLeft !== null && secondsLeft <= (countdown?.pingSeconds ?? 0);
}
