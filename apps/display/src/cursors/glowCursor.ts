import { hexToLinear } from "@entertheblackbox/shared";
import { CORE_RADIUS } from "../curtain/curtainRenderer.js";
import { PULSE_DECAY_MS } from "../curtain/curtainScene.js";

/**
 * Cursor glows outside the curtain stage. Director decision 2026-11-21: every
 * cursor looks like a curtain-light cursor, so these mirror the curtain's
 * cursor cores (curtainRenderer pass 3, CurtainScene.cursorLights): a soft
 * Gaussian light in the participant's colour mixed with white, added on top
 * of whatever the scene shows, swelling briefly when its phone is touched.
 */

/** Core amount of a cursor outside a counting area on the curtain. */
export const GLOW_CORE = 0.8;
/** Same falloff sharpness as the curtain's cursor cores. */
export const GLOW_SHARPNESS = 3.5;

export type GlowCursorInput = { x: number; y: number; color: string; ghost: boolean; pulseAt?: number | undefined };
export type GlowSprite = {
  /** Centre in canvas pixels. */
  cx: number;
  cy: number;
  /** Sprite radius in canvas pixels (the Gaussian reaches zero there). */
  radius: number;
  /** Display-space tint (0..1 per channel), the colour the core adds at full amount. */
  tint: [number, number, number];
  /** Light amount; may exceed 1 while pulsing. */
  amount: number;
};

/** The curtain's core tint: the participant's colour lifted towards white. */
export function glowTint(color: string): [number, number, number] {
  const [r, g, b] = hexToLinear(color);
  return [0.35 + 0.65 * r, 0.35 + 0.65 * g, 0.35 + 0.65 * b];
}

/** Touch pulse 0..1, decaying like the curtain's. */
export function glowPulse(pulseAt: number | undefined, now: number): number {
  return pulseAt === undefined ? 0 : Math.exp(-Math.max(0, now - pulseAt) / PULSE_DECAY_MS);
}

/** Where and how bright each cursor glow is drawn; `opacity` is the per-cursor fade (ghost, blink). */
export function glowSprites(
  cursors: readonly GlowCursorInput[],
  width: number,
  height: number,
  now: number,
  opacity: (cursor: GlowCursorInput) => number,
): GlowSprite[] {
  return cursors.flatMap((cursor) => {
    const fade = opacity(cursor);
    if (fade <= 0) return [];
    const pulse = glowPulse(cursor.pulseAt, now);
    return [{
      cx: cursor.x * width,
      cy: cursor.y * height,
      radius: CORE_RADIUS * height * (1 + 1.2 * pulse),
      tint: glowTint(cursor.color),
      amount: GLOW_CORE * (1 + 1.6 * pulse) * fade,
    }];
  });
}

/** Gaussian falloff at normalised distance² `d2` from the centre (0 at the rim). */
export function glowFalloff(d2: number): number {
  return d2 >= 1 ? 0 : Math.exp(-d2 * GLOW_SHARPNESS) * (1 - d2);
}

const SPRITE_SIZE = 96;

/**
 * One pre-rendered glow per colour. Pixels carry the tint at full strength
 * and the falloff as alpha, so with additive ("lighter") compositing each
 * pixel adds tint × falloff, as the curtain's sprite shader does.
 */
export class GlowSpriteCache {
  private readonly sprites = new Map<string, HTMLCanvasElement>();

  get(tint: readonly [number, number, number]): HTMLCanvasElement | null {
    const key = tint.map((value) => value.toFixed(3)).join(",");
    const cached = this.sprites.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(SPRITE_SIZE, SPRITE_SIZE);
    const half = SPRITE_SIZE / 2;
    const [r, g, b] = tint.map((value) => Math.round(Math.min(1, value) * 255)) as [number, number, number];
    for (let y = 0; y < SPRITE_SIZE; y += 1) {
      for (let x = 0; x < SPRITE_SIZE; x += 1) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const o = (y * SPRITE_SIZE + x) * 4;
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = Math.round(glowFalloff(dx * dx + dy * dy) * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    this.sprites.set(key, canvas);
    return canvas;
  }
}

/** Adds one glow; amounts above 1 are drawn as several additive passes. */
export function drawGlow(ctx: CanvasRenderingContext2D, sprite: CanvasImageSource, glow: GlowSprite): void {
  const passes = Math.max(1, Math.ceil(glow.amount));
  ctx.globalAlpha = glow.amount / passes;
  const size = glow.radius * 2;
  for (let pass = 0; pass < passes; pass += 1) {
    ctx.drawImage(sprite, glow.cx - glow.radius, glow.cy - glow.radius, size, size);
  }
}
