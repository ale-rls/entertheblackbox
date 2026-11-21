import { describe, expect, it, vi } from "vitest";
import { CORE_RADIUS } from "../curtain/curtainRenderer.js";
import { PULSE_DECAY_MS } from "../curtain/curtainScene.js";
import { GLOW_CORE, drawGlow, glowFalloff, glowPulse, glowSprites, glowTint } from "./glowCursor.js";

const full = () => 1;

describe("glow cursors", () => {
  it("places a curtain-sized core at the cursor", () => {
    const [glow] = glowSprites([{ x: 0.25, y: 0.5, color: "#ffffff", ghost: false }], 1920, 1080, 0, full);
    expect(glow).toMatchObject({ cx: 480, cy: 540, amount: GLOW_CORE });
    expect(glow!.radius).toBeCloseTo(CORE_RADIUS * 1080);
  });

  it("lifts the participant colour towards white like the curtain cores", () => {
    expect(glowTint("#ffffff")).toEqual([1, 1, 1]);
    const [r, g, b] = glowTint("#ff0000");
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(0.35);
    expect(b).toBeCloseTo(0.35);
  });

  it("swells on a touch and settles back", () => {
    const cursor = { x: 0.5, y: 0.5, color: "#ffffff", ghost: false, pulseAt: 1000 };
    const [touched] = glowSprites([cursor], 100, 100, 1000, full);
    const [later] = glowSprites([cursor], 100, 100, 1000 + 10 * PULSE_DECAY_MS, full);
    expect(touched!.amount).toBeCloseTo(GLOW_CORE * 2.6);
    expect(touched!.radius).toBeCloseTo(CORE_RADIUS * 100 * 2.2);
    expect(later!.amount).toBeCloseTo(GLOW_CORE, 3);
    expect(glowPulse(undefined, 5000)).toBe(0);
  });

  it("applies the per-cursor fade and drops invisible cursors", () => {
    const cursors = [
      { x: 0.1, y: 0.1, color: "#ffffff", ghost: true },
      { x: 0.9, y: 0.9, color: "#ffffff", ghost: false },
    ];
    const glows = glowSprites(cursors, 100, 100, 0, (cursor) => (cursor.ghost ? 0.5 : 0));
    expect(glows).toHaveLength(1);
    expect(glows[0]!.amount).toBeCloseTo(GLOW_CORE * 0.5);
  });

  it("falls off to nothing at the rim", () => {
    expect(glowFalloff(0)).toBe(1);
    expect(glowFalloff(0.5)).toBeGreaterThan(0);
    expect(glowFalloff(1)).toBe(0);
  });

  it("draws amounts above 1 as several passes that add up", () => {
    const ctx = { globalAlpha: 1, drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawGlow(ctx, {} as CanvasImageSource, { cx: 50, cy: 40, radius: 10, tint: [1, 1, 1], amount: 2.08 });
    expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    expect(ctx.globalAlpha * 3).toBeCloseTo(2.08);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 40, 30, 20, 20);
  });
});
