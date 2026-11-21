import { z } from "zod";

/**
 * A visible countdown on a video or narration scene, on the scene timeline (ms from scene start):
 * e.g. "30 seconds to build the still image". The final `pingSeconds` tick audibly on the display.
 */
export const sceneCountdownSchema = z.object({
  startAtMs: z.number().int().nonnegative(),
  endAtMs: z.number().int().positive(),
  pingSeconds: z.number().int().min(0).max(60).optional(),
  /** Show an amount counting down from this number to 0 instead of seconds (e.g. 2.000.000 tokens). */
  countFrom: z.number().int().positive().max(1_000_000_000_000).optional(),
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

/**
 * An amount counting down in step with the time left: `countFrom` with the
 * whole window remaining, 0 at the end. Rounded up so it reaches 0 only at the end.
 */
export function countdownAmount(countFrom: number, remainingMs: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return Math.max(0, Math.min(countFrom, Math.ceil(countFrom * Math.max(0, remainingMs) / windowMs)));
}

/** German grouping for large numbers on the displays: 2000000 → "2.000.000". */
export function formatCountdownAmount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** What a scene countdown shows at `elapsedMs`: whole seconds, or the mapped amount; null outside it. */
export function sceneCountdownText(countdown: SceneCountdown | undefined, elapsedMs: number): string | null {
  const seconds = sceneCountdownSeconds(countdown, elapsedMs);
  if (seconds === null || !countdown) return null;
  if (countdown.countFrom === undefined) return String(seconds);
  return formatCountdownAmount(countdownAmount(countdown.countFrom, countdown.endAtMs - elapsedMs, countdown.endAtMs - countdown.startAtMs));
}

/** True while the countdown should ping once per second. */
export function sceneCountdownPings(countdown: SceneCountdown | undefined, secondsLeft: number | null): boolean {
  return secondsLeft !== null && secondsLeft <= (countdown?.pingSeconds ?? 0);
}
