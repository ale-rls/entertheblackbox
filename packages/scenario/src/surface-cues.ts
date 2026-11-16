import { z } from "zod";
import { SURFACE_EFFECT_KINDS, SURFACE_EFFECT_MAX_PERIOD_MS, SURFACE_EFFECT_MIN_PERIOD_MS, type SurfaceEffect } from "@entertheblackbox/shared";

const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, "colour must be #rrggbb");

/** One Admin Instrument effect, as a scene cue authors it. */
export const surfaceCueEffectSchema = z.object({
  kind: z.enum(SURFACE_EFFECT_KINDS),
  color: hexColorSchema,
  /** Second colour for gradient; ignored by the other effects. */
  color2: hexColorSchema.optional(),
  /** One full cycle in ms. */
  periodMs: z.number().int().min(SURFACE_EFFECT_MIN_PERIOD_MS).max(SURFACE_EFFECT_MAX_PERIOD_MS),
  /** Master dimmer 0–1; defaults to full. */
  brightness: z.number().min(0).max(1).optional(),
});

/**
 * Timed tablet-light cue on a scene: `atMs` after the scene starts, start an
 * Instrument effect on every joined device (label order) or stop it.
 */
export const surfaceCueSchema = z.discriminatedUnion("action", [
  z.object({ atMs: z.number().int().nonnegative(), action: z.literal("start"), effect: surfaceCueEffectSchema }),
  z.object({ atMs: z.number().int().nonnegative(), action: z.literal("stop") }),
]);

export const surfaceCuesSchema = z.array(surfaceCueSchema).max(32);

export type SurfaceCue = z.infer<typeof surfaceCueSchema>;
export type SurfaceCueEffect = z.infer<typeof surfaceCueEffectSchema>;

/** The runner's full effect from an authored one (defaults filled in). */
export function surfaceCueEffect(effect: SurfaceCueEffect): SurfaceEffect {
  return { kind: effect.kind, color: effect.color, color2: effect.color2 ?? effect.color, periodMs: effect.periodMs, brightness: effect.brightness ?? 1 };
}

/** Cues in firing order (stable for equal times). */
export function orderedSurfaceCues(cues: readonly SurfaceCue[] | undefined): SurfaceCue[] {
  return (cues ?? []).map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.atMs - b.cue.atMs || a.index - b.index).map(({ cue }) => cue);
}
