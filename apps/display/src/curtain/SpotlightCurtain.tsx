import { useEffect, useRef } from "react";
import type { CursorField } from "../cursors/cursorField.js";
import type { ServerClock } from "../lib/serverClock.js";
import { CurtainRenderer, type CursorLight } from "./curtainRenderer.js";

const GROW_MS = 700;
const CURSOR_RADIUS = 0.008;
const WHITE = [1, 1, 1] as const;

export function SpotlightCurtain({ field, clock, size, startedAt, deadlineAt, grow, videoUrl }: {
  field: CursorField;
  clock: ServerClock;
  size: number;
  startedAt: number;
  deadlineAt: number;
  grow: boolean;
  videoUrl: string | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const liveVideoUrl = useRef(videoUrl);
  liveVideoUrl.current = videoUrl;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: CurtainRenderer;
    try {
      renderer = new CurtainRenderer(canvas);
    } catch (error) {
      console.warn("display: spotlight rendering requires WebGL2", error);
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    let source: string | null = null;
    let raf = 0;
    const draw = () => {
      if (liveVideoUrl.current !== source) {
        source = liveVideoUrl.current;
        if (source) {
          video.src = source;
          void video.play().catch(error => console.warn("display: spotlight curtain video did not start", error));
        }
      }
      const now = clock.now();
      const width = Math.min(1920, Math.max(1, Math.round(canvas.clientWidth * window.devicePixelRatio)));
      const height = Math.max(1, Math.round(width * canvas.clientHeight / Math.max(1, canvas.clientWidth)));
      renderer.resize(width, height);
      renderer.uploadVideo(source ? video : null);
      const progress = grow ? Math.max(0, Math.min(1, (Math.min(now, deadlineAt) - startedAt) / GROW_MS)) : 1;
      const targetRadius = size / 200;
      const radius = CURSOR_RADIUS + (targetRadius - CURSOR_RADIUS) * progress * (2 - progress);
      const cursors: CursorLight[] = field.renderAt(now >= deadlineAt ? Infinity : Date.now())
        .filter(cursor => !cursor.ghost)
        .map(cursor => ({ x: cursor.x, y: cursor.y, rgb: WHITE, floodRgb: WHITE, flood: 1, core: 0, pulse: 0 }));
      renderer.render({
        opacity: 1, cursorOpacity: 1, spotlightRadius: radius,
        fabric: { baked: 0, folds: 1.2, shine: 0.85, shadow: 0.4 }, cursors,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      if (source) { video.pause(); video.removeAttribute("src"); video.load(); }
    };
  }, [field, clock, size, startedAt, deadlineAt, grow]);

  return <canvas ref={ref} className="curtain-canvas" aria-hidden="true" />;
}
