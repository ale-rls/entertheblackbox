import { useEffect, useMemo, useRef } from "react";
import type { PositionField } from "@smartphonecracy/scenario";
import type { ServerClock } from "../lib/serverClock.js";
import type { CursorField } from "./cursorField.js";
import { projectOntoSegment, proximityStrength, spectrumSegment } from "./spectrumGlow.js";

const DENSITY_BINS = 96;
const RESPONSE_MS = 180;

/**
 * A deliberately low-resolution, additive pass beneath the UI. Each cursor
 * contributes to its nearest point on the spectrum, attenuated by distance;
 * overlapping contributions therefore brighten into a diffuse heatmap.
 */
export function SpectrumGlowCanvas({
  cursorField,
  field,
  clock,
  visibleFrom = Number.NEGATIVE_INFINITY,
  visibleUntil = Number.POSITIVE_INFINITY,
}: {
  cursorField: CursorField;
  field: PositionField;
  clock: ServerClock;
  visibleFrom?: number;
  visibleUntil?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const segment = useMemo(() => spectrumSegment(field), [field]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || segment === null) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastFrame = performance.now();
    let resolutionScale = 0.5;
    const density = new Float32Array(DENSITY_BINS);
    const targetDensity = new Float32Array(DENSITY_BINS);

    const resize = () => {
      // The CSS stretch supplies the final diffusion for free. Capping this
      // layer below device resolution keeps a 4K installation inexpensive.
      resolutionScale = 0.45 * Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * resolutionScale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * resolutionScale));
    };
    resize();
    window.addEventListener("resize", resize);

    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    const draw = (frameTime: number) => {
      const now = clock.now();
      const elapsed = Math.min(64, Math.max(0, frameTime - lastFrame));
      lastFrame = frameTime;
      const response = 1 - Math.exp(-elapsed / RESPONSE_MS);

      targetDensity.fill(0);
      if (now >= visibleFrom && now < visibleUntil) {
        const cssWidth = canvas.clientWidth;
        const cssHeight = canvas.clientHeight;
        const influenceDistance = Math.max(72, Math.min(cssWidth, cssHeight) * 0.12);

        for (const cursor of cursorField.renderAt(performance.timeOrigin + performance.now())) {
          const projection = projectOntoSegment(cursor, segment, cssWidth, cssHeight);
          const strength = proximityStrength(projection.distance, influenceDistance);
          if (strength === 0) continue;
          const bin = Math.min(DENSITY_BINS - 1, Math.floor(projection.position * DENSITY_BINS));
          targetDensity[bin] = targetDensity[bin]! + strength * (cursor.ghost ? 0.45 : 1);
        }
      }

      let hasGlow = false;
      for (let i = 0; i < DENSITY_BINS; i += 1) {
        const nextDensity = density[i]! + (targetDensity[i]! - density[i]!) * response;
        density[i] = nextDensity;
        if (nextDensity > 0.005) hasGlow = true;
      }

      clear();
      if (hasGlow) {
        const width = canvas.width;
        const height = canvas.height;
        const startX = segment.start.x * width;
        const startY = segment.start.y * height;
        const dx = (segment.end.x - segment.start.x) * width;
        const dy = (segment.end.y - segment.start.y) * height;
        const radius = Math.max(24, Math.min(width, height) * 0.055);
        ctx.globalCompositeOperation = "lighter";

        for (let i = 0; i < DENSITY_BINS; i += 1) {
          const binDensity = density[i]!;
          if (binDensity <= 0.005) continue;
          const position = (i + 0.5) / DENSITY_BINS;
          const x = startX + dx * position;
          const y = startY + dy * position;
          // Exponential compression keeps large crowds luminous without
          // flattening every cluster into the same fully-clipped white.
          const intensity = 1 - Math.exp(-binDensity * 0.22);
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `rgb(255 255 255 / ${0.72 * intensity})`);
          gradient.addColorStop(0.22, `rgb(170 235 255 / ${0.5 * intensity})`);
          gradient.addColorStop(0.58, `rgb(70 190 255 / ${0.24 * intensity})`);
          gradient.addColorStop(1, "rgb(40 150 255 / 0)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [clock, cursorField, segment, visibleFrom, visibleUntil]);

  if (segment === null) return null;
  return <canvas ref={canvasRef} className="spectrum-glow-canvas" aria-hidden />;
}
