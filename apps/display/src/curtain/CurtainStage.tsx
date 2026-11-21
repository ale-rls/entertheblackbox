import { useEffect, useMemo, useRef } from "react";
import type { CurtainTreatment } from "@entertheblackbox/protocol";
import type { PositionField } from "@entertheblackbox/shared";
import type { ServerClock } from "../lib/serverClock.js";
import type { CursorField } from "../cursors/cursorField.js";
import { CurtainRenderer } from "./curtainRenderer.js";
import { CurtainScene } from "./curtainScene.js";
import { stepTextSwap, type TextSwap } from "./textSwap.js";
import { curtainVisibility } from "./visibility.js";

export { CURTAIN_LEAVE_MS } from "./visibility.js";
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
  /**
   * Server time the question appears (the fabric is up before, from its first
   * video frame), and the time it must be gone by when the question hides
   * before its scene ends. Consecutive curtain votes keep one stage: the
   * fabric stays and only the question text changes.
   */
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
  ctx.font = `700 ${current}px ${FONT}`;
  while (current > 8 && ctx.measureText(text).width > maxWidth) {
    current *= 0.92;
    ctx.font = `700 ${current}px ${FONT}`;
  }
  return current;
}

/** White lettering with a dark halo stays readable over every answer pool. */
function paint(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  ctx.fillStyle = "rgb(255 255 255)";
  ctx.shadowColor = "rgb(0 0 0 / 70%)";
  ctx.shadowBlur = size * 0.35;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function drawText(canvas: HTMLCanvasElement, question: string, scene: CurtainScene): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  // Field divisions: a thin, soft white cross so the neutral fields read as separate areas.
  ctx.save();
  ctx.strokeStyle = "rgb(255 255 255 / 55%)";
  ctx.lineWidth = Math.max(1.5, width * 0.0016);
  ctx.lineCap = "round";
  ctx.shadowColor = "rgb(0 0 0 / 60%)";
  ctx.shadowBlur = width * 0.004;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of scene.divisions) {
    ctx.moveTo(x1 * width, y1 * height);
    ctx.lineTo(x2 * width, y2 * height);
  }
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = "center";
  // Title: centre top, 4.2% of width, top edge at 5% of height, at most 88% wide.
  ctx.textBaseline = "top";
  const titleSize = fitFont(ctx, question, width * 0.042, width * 0.88);
  paint(ctx, question, width / 2, height * 0.05, titleSize);
  // Answer words: 2.8% of width, centred on each pool, at most 24% wide. All answers share
  // one size, the one the longest needs, so a long answer never looks quieter than a short one.
  ctx.textBaseline = "middle";
  const labelSize = Math.min(width * 0.028, ...scene.labels.map((label) => fitFont(ctx, label.text, width * 0.028, width * 0.24)));
  ctx.font = `700 ${labelSize}px ${FONT}`;
  for (const label of scene.labels) paint(ctx, label.text, label.x * width, label.y * height, labelSize);
}

/**
 * The lit curtain for a run of curtain-light votes: packed fabric video, answer
 * pools driven by the authoritative live counts, and one light per cursor.
 * A new question swaps the text and pools without rebuilding the renderer or
 * restarting the fabric video.
 * Everything time-dependent is read through refs so a 60 fps loop never
 * re-renders React.
 */
export function CurtainStage(props: CurtainStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(props);
  live.current = props;
  const scene = useMemo(() => new CurtainScene(props.field, props.treatment), [props.field, props.treatment]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

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
      if (url === null) { video.removeAttribute("src"); video.load(); renderer.clearVideo(); return; }
      video.src = url;
      void video.play().catch((error: unknown) => console.warn("curtain: video did not start", error));
    };

    // What the curtain shows (labels, divisions, lit areas) and the question it belongs to.
    // A new question replaces it after the old text has faded out (see stepTextSwap).
    let target = { scene: sceneRef.current, question: live.current.question };
    let swap: TextSwap<typeof target> = { shown: target, startedAt: null };

    let raf = 0;
    let last = performance.now();
    const frame = (frameTime: number) => {
      const p = live.current;
      const scene = sceneRef.current;
      const local = Date.now();
      const now = p.clock.now();
      const leaving = p.leavingSince ?? null;
      const { fabric: opacity, content } = curtainVisibility({
        now,
        visibleFrom: p.visibleFrom,
        visibleUntil: p.visibleUntil,
        leavingForMs: leaving === null ? null : local - leaving,
        videoReady: renderer.videoReady,
      });

      if (target.scene !== scene || target.question !== p.question) target = { scene, question: p.question };
      // Before the question is due there is no old text on screen to fade out.
      const step = stepTextSwap(swap, target, opacity > 0.01 && content, local);
      swap = step.swap;
      if (step.redraw) textDirty = true;
      const shown = swap.shown;
      const swapping = swap.startedAt !== null;
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
        drawText(text, shown.question, shown.scene);
        renderer.uploadText(text);
        textDirty = false;
      }

      const elapsed = Math.min(100, Math.max(0, frameTime - last));
      last = frameTime;
      const closed = p.closed || leaving !== null;
      // Lit areas follow the content on screen: during a swap the old question's areas settle to
      // their base glow (the live counts belong to the new question) until its labels are gone.
      const lit = shown.scene;
      lit.step(elapsed, swapping ? null : p.liveCounts, closed, local);
      const light = lit.lightMap();
      if (!content) light.fill(0);
      renderer.uploadPools(light, lit.pools.columns, lit.pools.rows);
      renderer.uploadVideo(video);

      renderer.render({
        opacity,
        textOpacity: content ? step.textOpacity : 0,
        cursorOpacity: content ? lit.cursorOpacity(local) : 0,
        fabric: p.treatment.curtain,
        cursors: lit.cursorLights(p.cursorField.renderAt(local), local),
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
  }, []);

  // Question changes swap the text through a short fade on the next frames.
  return <canvas ref={canvasRef} className="curtain-canvas" aria-label={props.question} />;
}
