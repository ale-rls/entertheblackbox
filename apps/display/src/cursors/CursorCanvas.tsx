import { useEffect, useRef } from "react";
import type { CursorField } from "./cursorField.js";

export function cursorOpacity(ghost: boolean, blinkActiveVoters: boolean, frozen: boolean, at: number): number {
  if (ghost) return 0.5;
  if (!blinkActiveVoters || !frozen) return 1;
  return Math.floor(at / 320) % 2 === 0 ? 1 : 0.08;
}

/**
 * Canvas cursor layer: draws one crisp dot per interpolated cursor. When
 * `showCursors` is false, the canvas is cleared and nothing is drawn each
 * frame, but the RAF loop keeps running underneath (CursorField keeps
 * ingesting) so rendering resumes instantly and correctly-positioned once
 * it flips back true -- gated at render time, not ingestion time.
 */
export function CursorCanvas({
  field,
  showCursors = true,
  blinkActiveVoters = false,
}: {
  field: CursorField;
  showCursors?: boolean;
  blinkActiveVoters?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

      if (showCursors) {
        const radius = Math.max(6, Math.round(height * 0.008));
        const renderAt = performance.timeOrigin + performance.now();
        for (const cursor of field.renderAt(renderAt)) {
          const cx = cursor.x * width;
          const cy = cursor.y * height;
          ctx.globalAlpha = cursorOpacity(cursor.ghost, blinkActiveVoters, field.isFrozen, renderAt);
          ctx.fillStyle = cursor.color;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [blinkActiveVoters, field, showCursors]);

  return <canvas ref={canvasRef} className="cursor-canvas" />;
}
