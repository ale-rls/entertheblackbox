import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { CurtainTreatment } from "@entertheblackbox/protocol";
import type { PositionField } from "@entertheblackbox/shared";
import type { ServerClock } from "../lib/serverClock.js";
import type { CursorField } from "../cursors/cursorField.js";
import { CurtainRenderer } from "./curtainRenderer.js";
import { CurtainScene } from "./curtainScene.js";
import { stepTextSwap, type TextSwap } from "./textSwap.js";
import { curtainVisibility, dimmedBaked, easeLevel } from "./visibility.js";
import type { ActiveLoopVideo } from "../components/LoopVideo.js";

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
  /**
   * The scene loop on screen. A vote lit over that loop (a plain fabric with the same src)
   * draws this element's frames instead of playing its own copy, so it continues the loop
   * on the show's clock rather than starting it again from its first frame.
   */
  sceneLoop?: RefObject<ActiveLoopVideo | null>;
  onUnavailable?: (error: unknown) => void;
  /** `baked` the fabric dims in from (default DIM_START_BAKED): a dimmed title's level. */
  dimFrom?: number;
  /** Called once, on the first frame this stage's fabric is on screen. */
  onFabricShown?: () => void;
  /** Cursor size from Admin (1 = normal). */
  cursorSize?: number;
  /** Fraction of the width kept clear of text on each side (display settings). */
  textSafeArea?: number;
};

/**
 * Where a centred label of `textWidth` goes so it stays inside the side safe area:
 * its pool's centre, moved inward just enough when the word would cross the edge.
 */
export function safeLabelX(x: number, textWidth: number, width: number, safe: number): number {
  const left = width * safe + textWidth / 2;
  const right = width * (1 - safe) - textWidth / 2;
  return left > right ? width / 2 : Math.min(right, Math.max(left, x));
}

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

function drawText(canvas: HTMLCanvasElement, question: string, scene: CurtainScene, safe: number): void {
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
  // Title: centre top, 4.2% of width, top edge at 5% of height, at most 88% wide and inside the safe area.
  ctx.textBaseline = "top";
  const titleSize = fitFont(ctx, question, width * 0.042, Math.min(width * 0.88, width * (1 - 2 * safe)));
  paint(ctx, question, width / 2, height * 0.05, titleSize);
  // Answer words: 2.8% of width, centred on each pool, at most 24% wide. All answers share
  // one size, the one the longest needs, so a long answer never looks quieter than a short one.
  ctx.textBaseline = "middle";
  const labelSize = Math.min(width * 0.028, ...scene.labels.map((label) => fitFont(ctx, label.text, width * 0.028, width * 0.24)));
  ctx.font = `700 ${labelSize}px ${FONT}`;
  // Labels near the left or right edge (the ends of a scale) move inward to stay inside the safe area.
  for (const label of scene.labels) paint(ctx, label.text, safeLabelX(label.x * width, ctx.measureText(label.text).width, width, safe), label.y * height, labelSize);
}

/**
 * The lit curtain for a run of curtain-light votes: packed fabric video (or the
 * scene's running loop), answer pools driven by the authoritative live counts,
 * and one light per cursor.
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
    let drawnSafe = -1;
    const markText = () => { textDirty = true; };
    void document.fonts?.ready.then(markText);

    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    let videoUrl: string | null = null;
    // Drawing the scene loop's own element; once it has, a vanished loop (the scene moved on)
    // leaves its last frame on the fabric for the fade-out instead of restarting a copy.
    let onSceneLoop = false;
    const sceneLoopFor = (p: CurtainStageProps): HTMLVideoElement | null => {
      if (p.treatment.curtain.packed !== false) return null;
      const loop = p.sceneLoop?.current ?? null;
      return loop !== null && loop.src === p.treatment.curtain.src ? loop.element : null;
    };
    const syncVideo = () => {
      const url = onSceneLoop ? null : live.current.videoUrl;
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
    // Local time this stage's fabric first showed; the lit curtain dims in from there.
    let upAt: number | null = null;
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

      if (opacity > 0 && upAt === null) {
        upAt = local;
        p.onFabricShown?.();
      }
      if (target.scene !== scene || target.question !== p.question) target = { scene, question: p.question };
      // Before the question is due there is no old text on screen to fade out.
      const step = stepTextSwap(swap, target, opacity > 0.01 && content, local);
      swap = step.swap;
      if (step.redraw) textDirty = true;
      const shown = swap.shown;
      const swapping = swap.startedAt !== null;
      const sceneLoop = sceneLoopFor(p);
      if (sceneLoop !== null) onSceneLoop = true;
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
      const safe = p.textSafeArea ?? 0;
      if (safe !== drawnSafe) { drawnSafe = safe; textDirty = true; }
      if (textDirty) {
        drawText(text, shown.question, shown.scene, safe);
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
      if (sceneLoop !== null) renderer.uploadVideo(sceneLoop);
      else if (!onSceneLoop) renderer.uploadVideo(video);

      // Over the running scene loop the lit curtain draws the same frames, but Chrome composites a
      // <video> a few percent differently from WebGL (levels, softness): it fades in over the loop
      // across the dim-in second instead of replacing it on one frame.
      const overLoop = onSceneLoop && p.treatment.curtain.packed === false;
      const fadeIn = overLoop && upAt !== null ? easeLevel(0, 1, local - upAt) : 1;
      renderer.render({
        opacity: opacity * fadeIn,
        textOpacity: content ? step.textOpacity : 0,
        cursorOpacity: content ? lit.cursorOpacity(local) : 0,
        // A vote right after another keeps this stage, so only a fresh curtain dims in.
        fabric: { ...p.treatment.curtain, baked: dimmedBaked(p.treatment.curtain.baked, upAt === null ? null : local - upAt, p.dimFrom) },
        cursors: lit.cursorLights(p.cursorField.renderAt(local), local),
        cursorSize: p.cursorSize ?? 1,
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
