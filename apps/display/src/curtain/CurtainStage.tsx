import { useEffect, useMemo, useRef } from "react";
import type { CurtainTreatment } from "@entertheblackbox/protocol";
import { poolCoverageAt, type PositionField } from "@entertheblackbox/shared";
import type { ServerClock } from "../lib/serverClock.js";
import type { CursorField } from "../cursors/cursorField.js";
import { CurtainRenderer } from "./curtainRenderer.js";
import { CurtainScene } from "./curtainScene.js";

const FADE_IN_MS = 700;
const FADE_OUT_MS = 900;
/** How long a finished curtain stays on screen, fading into the next scene. */
export const CURTAIN_LEAVE_MS = 1_200;
const MAX_RENDER_WIDTH = 1920;
const FONT = '"Optik", system-ui, sans-serif';

export type CurtainStageProps = {
  treatment: CurtainTreatment;
  field: PositionField;
  question: string;
  cursorField: CursorField;
  clock: ServerClock;
  liveCounts: Readonly<Record<string, number>> | null;
  /** The vote is resolved: lights calm down and cursor lights fade. */
  closed: boolean;
  /** Server time the lighting scene starts / must be gone by (video-timed questions). */
  visibleFrom?: number;
  visibleUntil?: number;
  /** Local time the phase moved on; the curtain fades into the next scene. */
  leavingSince?: number | null;
  videoUrl: string | null;
  onUnavailable?: (error: unknown) => void;
};

/** Fit text into maxWidth by shrinking, never by wrapping. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number): number {
  let current = size;
  ctx.font = `500 ${current}px ${FONT}`;
  while (current > 8 && ctx.measureText(text).width > maxWidth) {
    current *= 0.92;
    ctx.font = `500 ${current}px ${FONT}`;
  }
  return current;
}

/**
 * Ink for one text item, decided once for the whole word: dark letters cut
 * out of a lit pool, pale letters on unlit fabric. Encoded in the red
 * channel (255 = pale) and read by the fabric shader.
 */
function inkFor(scene: CurtainScene, x0: number, x1: number, y: number): "dark" | "pale" {
  // Dark only when the whole word sits in light; any unlit part makes it pale.
  const samples = 9;
  for (let i = 0; i < samples; i += 1) {
    if (poolCoverageAt(scene.pools, x0 + (x1 - x0) * (i / (samples - 1)), y) < 0.3) return "pale";
  }
  return "dark";
}

function paint(ctx: CanvasRenderingContext2D, ink: "dark" | "pale", text: string, x: number, y: number, size: number): void {
  ctx.fillStyle = ink === "dark" ? "rgb(0 0 0)" : "rgb(255 255 255)";
  // Pale words get a soft dark halo so they also hold over a lit edge.
  ctx.shadowColor = ink === "pale" ? "rgb(0 0 0 / 70%)" : "transparent";
  ctx.shadowBlur = ink === "pale" ? size * 0.35 : 0;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function drawText(canvas: HTMLCanvasElement, question: string, scene: CurtainScene): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = "center";
  // Title: centre top, 4.2% of width, top edge at 5% of height, at most 88% wide.
  ctx.textBaseline = "top";
  const titleSize = fitFont(ctx, question, width * 0.042, width * 0.88);
  const titleWidth = ctx.measureText(question).width / width;
  paint(ctx, inkFor(scene, 0.5 - titleWidth / 2, 0.5 + titleWidth / 2, 0.05 + titleSize / height / 2), question, width / 2, height * 0.05, titleSize);
  // Answer words: 2.8% of width, centred on each pool, at most 24% wide.
  ctx.textBaseline = "middle";
  for (const label of scene.labels) {
    const size = fitFont(ctx, label.text, width * 0.028, width * 0.24);
    const labelWidth = ctx.measureText(label.text).width / width;
    paint(ctx, inkFor(scene, label.x - labelWidth / 2, label.x + labelWidth / 2, label.y), label.text, label.x * width, label.y * height, size);
  }
}

/**
 * The lit curtain for one curtain-light vote: packed fabric video, answer
 * pools driven by the authoritative live counts, and one light per cursor.
 * Everything time-dependent is read through refs so a 60 fps loop never
 * re-renders React.
 */
export function CurtainStage(props: CurtainStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(props);
  live.current = props;
  const scene = useMemo(() => new CurtainScene(props.field, props.treatment), [props.field, props.treatment]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: CurtainRenderer;
    try {
      renderer = new CurtainRenderer(canvas);
    } catch (error) {
      live.current.onUnavailable?.(error);
      return;
    }
    const text = document.createElement("canvas");
    let textDirty = true;
    const markText = () => { textDirty = true; };
    void document.fonts?.ready.then(markText);

    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    let videoUrl: string | null = null;
    const syncVideo = () => {
      const url = live.current.videoUrl;
      if (url === videoUrl) return;
      videoUrl = url;
      if (url === null) { video.removeAttribute("src"); video.load(); return; }
      video.src = url;
      void video.play().catch((error: unknown) => console.warn("curtain: video did not start", error));
    };

    let raf = 0;
    let last = performance.now();
    const frame = (frameTime: number) => {
      const p = live.current;
      syncVideo();
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.min(MAX_RENDER_WIDTH, Math.max(1, Math.round(canvas.clientWidth * scale)));
      const height = Math.max(1, Math.round(width * canvas.clientHeight / Math.max(1, canvas.clientWidth)));
      if (text.width !== width || text.height !== height) {
        text.width = width;
        text.height = height;
        textDirty = true;
      }
      renderer.resize(width, height);
      if (textDirty) {
        drawText(text, p.question, scene);
        renderer.uploadText(text);
        textDirty = false;
      }

      const elapsed = Math.min(100, Math.max(0, frameTime - last));
      last = frameTime;
      const local = Date.now();
      const leaving = p.leavingSince ?? null;
      const closed = p.closed || leaving !== null;
      scene.step(elapsed, p.liveCounts, closed, local);
      renderer.uploadPools(scene.lightMap(), scene.pools.columns, scene.pools.rows);
      renderer.uploadVideo(video);

      const now = p.clock.now();
      const from = p.visibleFrom ?? Number.NEGATIVE_INFINITY;
      const until = p.visibleUntil ?? Number.POSITIVE_INFINITY;
      const fadeIn = Number.isFinite(from) ? Math.min(1, Math.max(0, (now - from) / FADE_IN_MS)) : 1;
      const fadeOut = Number.isFinite(until) ? Math.min(1, Math.max(0, (until - now) / FADE_OUT_MS)) : 1;
      const leave = leaving === null ? 1 : Math.max(0, 1 - (local - leaving) / CURTAIN_LEAVE_MS);
      renderer.render({
        opacity: fadeIn * fadeOut * leave,
        cursorOpacity: scene.cursorOpacity(local),
        fabric: p.treatment.curtain,
        cursors: scene.cursorLights(p.cursorField.renderAt(local), local),
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", markText);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", markText);
      video.pause();
      video.removeAttribute("src");
      video.load();
      renderer.dispose();
    };
  }, [scene]);

  // Question changes rebuild the text on the next frame via a new scene.
  return <canvas ref={canvasRef} className="curtain-canvas" aria-label={props.question} />;
}
