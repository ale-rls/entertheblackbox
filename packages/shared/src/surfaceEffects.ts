/**
 * Programmed colour effects for native show-mode surfaces (Admin Instrument).
 * Pure functions of (device index, device count, elapsed time), so the server
 * renders them for the tablets and Admin renders the same frames as a preview.
 */

export const SURFACE_EFFECT_KINDS = ["chase", "breathe", "wave", "gradient", "rainbow", "chaos"] as const;
export type SurfaceEffectKind = (typeof SURFACE_EFFECT_KINDS)[number];

export type SurfaceEffect = {
  kind: SurfaceEffectKind;
  /** Main colour (chase, breathe, wave, gradient start). */
  color: string;
  /** Second colour (gradient end). */
  color2: string;
  /** One full cycle: chase across every device, one breath, one wave pass, one chaos mood. */
  periodMs: number;
  /** Master dimmer, 0–1. */
  brightness: number;
};

export const SURFACE_EFFECT_MIN_PERIOD_MS = 200;
export const SURFACE_EFFECT_MAX_PERIOD_MS = 60_000;

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const match = HEX.exec(hex);
  return match ? [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)] : [0, 0, 0];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Scale a colour towards black: 1 leaves it unchanged, 0 is black. */
export function dimColor(hex: string, brightness: number): string {
  const level = Math.min(1, Math.max(0, brightness));
  return rgbToHex(hexToRgb(hex).map((c) => c * level) as Rgb);
}

export function mixColor(a: string, b: string, amount: number): string {
  const t = Math.min(1, Math.max(0, amount));
  const from = hexToRgb(a), to = hexToRgb(b);
  return rgbToHex(from.map((c, i) => c + (to[i]! - c) * t) as Rgb);
}

/** Hue 0–1 at full saturation and value. */
export function hueColor(hue: number): string {
  const h = ((hue % 1) + 1) % 1 * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return rgbToHex([r * 255, g * 255, b * 255]);
}

/** Deterministic hash of integers to [0, 1), so server and Admin preview draw the same chaos. */
export function noise(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x01000193);
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  }
  return (h >>> 0) / 4_294_967_296;
}

/** Shortest chaos flash; matches the server frame interval. */
export const CHAOS_TICK_MS = 50;

/**
 * Chaos: each device flickers white at random. Every device drifts through its
 * own calm and frantic stretches (one cycle long, offset per device) with its
 * own flash length, and now and then every device strikes at once.
 */
function chaosLevel(index: number, period: number, elapsed: number): number {
  const baseTick = Math.floor(elapsed / CHAOS_TICK_MS);
  if (noise(-1, baseTick, 7) < 0.015) return 1;
  const mood = Math.floor((elapsed + noise(index, 1) * period) / period);
  const activity = noise(index, mood, 2) ** 2;
  const tickMs = CHAOS_TICK_MS * (1 + Math.floor(noise(index, mood, 4) * 3));
  const tick = Math.floor(elapsed / tickMs);
  return noise(index, tick, mood, 3) < 0.04 + 0.55 * activity ? 1 : 0;
}

/** 0 → 1 → 0 over one cycle, starting dark. */
const pulse = (phase: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);

/** The colour device `index` of `count` shows `elapsedMs` into the effect. */
export function surfaceEffectColor(effect: SurfaceEffect, index: number, count: number, elapsedMs: number): string {
  const n = Math.max(1, count);
  const period = Math.min(SURFACE_EFFECT_MAX_PERIOD_MS, Math.max(SURFACE_EFFECT_MIN_PERIOD_MS, effect.periodMs));
  const cycle = Math.max(0, elapsedMs) / period;
  // Position along the row of devices, 0–1; the wave travels from the first label to the last.
  const offset = index / n;
  let color: string;
  switch (effect.kind) {
    case "chase": {
      const step = Math.floor(cycle * n) % n;
      const behind = (step - index + n) % n;
      // Lit device at full, a short fading tail behind it.
      color = dimColor(effect.color, behind === 0 ? 1 : behind === 1 && n > 2 ? 0.35 : behind === 2 && n > 4 ? 0.1 : 0);
      break;
    }
    case "breathe":
      color = dimColor(effect.color, pulse(cycle));
      break;
    case "wave":
      color = dimColor(effect.color, pulse(cycle - offset));
      break;
    case "gradient":
      color = mixColor(effect.color, effect.color2, pulse(cycle - offset));
      break;
    case "rainbow":
      color = hueColor(cycle - offset);
      break;
    case "chaos":
      color = dimColor("#ffffff", chaosLevel(index, period, Math.max(0, elapsedMs)));
      break;
  }
  return dimColor(color, effect.brightness);
}
