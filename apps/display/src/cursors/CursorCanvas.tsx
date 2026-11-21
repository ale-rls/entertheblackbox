import { useEffect, useRef } from "react";
import type { CursorField } from "./cursorField.js";
import { GlowSpriteCache, drawGlow, glowSprites } from "./glowCursor.js";

export function cursorOpacity(ghost: boolean, blinkActiveVoters: boolean, frozen: boolean, at: number): number {
  if (ghost) return 0.5;
  if (!blinkActiveVoters || !frozen) return 1;
  return Math.floor(at / 320) % 2 === 0 ? 1 : 0.08;
}

/**
 * Canvas cursor layer: draws one glow per interpolated cursor, in the look of
 * the curtain-light cursors (see glowCursor.ts), added onto the scene below
 * (`mix-blend-mode: plus-lighter` on `.layer-cursors`). When
 * `showCursors` is false, the canvas is cleared and nothing is drawn each
 * frame, but the RAF loop keeps running underneath (CursorField keeps
 * ingesting) so rendering resumes instantly and correctly-positioned once
 * it flips back true -- gated at render time, not ingestion time.
 */
export function CursorCanvas({
  field,
  showCursors = true,
  blinkActiveVoters = false,
  hiddenUntil,
}: {
  field: CursorField;
  showCursors?: boolean;
  blinkActiveVoters?: boolean;
  /** Cursors stay hidden while this returns true (e.g. the first seconds of a scene). */
  hiddenUntil?: (() => boolean) | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sprites = new GlowSpriteCache();
    let raf = 0;
    const resize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      if (showCursors && !hiddenUntil?.()) {
        const renderAt = performance.timeOrigin + performance.now();
        const frozen = field.isFrozen;
        const glows = glowSprites(field.renderAt(renderAt), width, height, renderAt,
          (cursor) => cursorOpacity(cursor.ghost, blinkActiveVoters, frozen, renderAt));
        ctx.globalCompositeOperation = "lighter";
        for (const glow of glows) {
          const sprite = sprites.get(glow.tint);
          if (sprite) drawGlow(ctx, sprite, glow);
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [blinkActiveVoters, field, showCursors, hiddenUntil]);

  return <canvas ref={canvasRef} className="cursor-canvas" />;
}
