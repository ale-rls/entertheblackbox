import type { CurtainTreatment } from "@entertheblackbox/protocol";
import {
  buildPoolMasks,
  composeLightMap,
  curtainLabels,
  cursorTint,
  hexToLinear,
  poolIntensities,
  quadrantOfField,
  type CurtainLabel,
  type PoolMasks,
  type PositionField,
} from "@entertheblackbox/shared";
import type { CursorLight } from "./curtainRenderer.js";

/** Pool brightness follows live counts with this time constant, so it breathes rather than flickers. */
export const POOL_RESPONSE_MS = 320;
/** A touch pulse decays with this time constant. */
export const PULSE_DECAY_MS = 380;
/** Cursor lights fade out over this long once the vote closes. */
export const CLOSE_FADE_MS = 900;

export type SceneCursor = { x: number; y: number; ghost: boolean; pulseAt?: number | undefined };

/**
 * Display-side state of one curtain-light vote, independent of WebGL: the
 * pool masks derived from the counting field, smoothed pool brightness, and
 * the per-cursor lights. Areas are fixed; only brightness follows the vote.
 */
export class CurtainScene {
  readonly pools: PoolMasks;
  readonly labels: CurtainLabel[];
  readonly colorsLinear: Array<[number, number, number]>;
  private readonly intensities: number[];
  private readonly light: ReturnType<typeof composeLightMap>;
  private closedAt: number | null = null;

  constructor(readonly field: PositionField, readonly treatment: CurtainTreatment) {
    this.pools = buildPoolMasks(field);
    this.labels = curtainLabels(field, this.pools);
    this.colorsLinear = this.pools.outcomes.map((id) => hexToLinear(treatment.answerColors[id] ?? "#ffffff"));
    this.intensities = this.pools.outcomes.map(() => treatment.curtain.poolBase);
    this.light = new Float32Array(this.pools.columns * this.pools.rows * 3);
  }

  /**
   * Ease pool brightness toward the authoritative counts. After the vote
   * closes every pool settles back to the base glow: no winner spotlight.
   */
  step(elapsedMs: number, counts: Readonly<Record<string, number>> | null, closed: boolean, now: number): void {
    if (closed && this.closedAt === null) this.closedAt = now;
    if (!closed) this.closedAt = null;
    const targets = poolIntensities(this.pools.outcomes, closed ? null : counts, this.treatment.curtain);
    const k = 1 - Math.exp(-Math.max(0, elapsedMs) / POOL_RESPONSE_MS);
    targets.forEach((target, i) => {
      this.intensities[i] = this.intensities[i]! + (target - this.intensities[i]!) * k;
    });
  }

  get currentIntensities(): readonly number[] {
    return this.intensities;
  }

  lightMap(): Float32Array {
    return composeLightMap(this.pools, this.colorsLinear, this.intensities, this.light);
  }

  /** 1 while voting, fading to 0 after the vote closes. */
  cursorOpacity(now: number): number {
    if (this.closedAt === null) return 1;
    return Math.max(0, 1 - (now - this.closedAt) / CLOSE_FADE_MS);
  }

  /**
   * One light per cursor: tinted toward the nearby answer colours, a
   * stronger flood once it stands in a counting area, and a brief pulse
   * when its participant touches their phone.
   */
  cursorLights(cursors: readonly SceneCursor[], now: number): CursorLight[] {
    const { cursorFlood, cursorFloodCounted } = this.treatment.curtain;
    return cursors.filter((cursor) => !cursor.ghost).map((cursor) => {
      const tint = cursorTint(this.pools, this.colorsLinear, cursor.x, cursor.y);
      const counted = quadrantOfField(this.field, cursor.x, cursor.y) !== null;
      const pulse = cursor.pulseAt === undefined ? 0 : Math.exp(-Math.max(0, now - cursor.pulseAt) / PULSE_DECAY_MS);
      return {
        x: cursor.x,
        y: cursor.y,
        rgb: tint.rgb,
        flood: counted ? cursorFloodCounted : cursorFlood,
        core: counted ? 1.1 : 0.8,
        pulse,
      };
    });
  }
}
