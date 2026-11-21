// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ServerClock } from "../lib/serverClock.js";
import { SCENE_END_HANDOVER_MS, VideoQuestionOverlay, videoQuestionStage, type VideoQuestionPhase } from "./VideoQuestionOverlay.js";

const quad = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** Two scenes in a row asking the same question, as T2-4-1 then T2-4-2. */
const first = {
  kind: "video-position-question",
  id: "upgrade-wahl",
  src: "curtain.png",
  expectedDurationMs: 10_000,
  text: "Welches Upgrade brauchst du dringend?",
  field: {
    type: "polygon-zones",
    zones: [
      { id: "gelb", label: "Mehr Energie", points: quad(0, 0, 0.47, 0.47) },
      { id: "blau", label: "Mehr Liebe", points: quad(0.53, 0, 1, 0.47) },
      { id: "gruen", label: "Mehr Mut", points: quad(0, 0.53, 0.47, 1) },
      { id: "rot", label: "Mehr Geduld", points: quad(0.53, 0.53, 1, 1) },
    ],
  },
  showAtMs: 500,
  openAtMs: 500,
  closeAtMs: 8_000,
  hideAtMs: 10_000,
  connectionStaleAfterMs: 3_000,
  showLiveCounts: false,
  next: { type: "fixed", target: "upgrade-gruppen" },
  scenarioVersion: "1",
  startedAt: 0,
  deadlineAt: 10_000,
} satisfies VideoQuestionPhase;
const second = { ...first, id: "upgrade-gruppen", startedAt: 10_000, deadlineAt: 20_000 } satisfies VideoQuestionPhase;
const different = { ...second, text: "Welches Upgrade soll zuerst aktiviert werden?" } satisfies VideoQuestionPhase;

let now = 0;
const clock = { now: () => now, remainingUntil: (at: number) => Math.max(0, at - now) } as ServerClock;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function show(phase: VideoQuestionPhase, at: number) {
  now = at;
  if (!root) {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
  }
  await act(async () => root?.render(
    <VideoQuestionOverlay phase={phase} clock={clock} liveField={null} liveCounts={null} resolution={null} />,
  ));
  return document.querySelector(".question-over-video");
}

describe("consecutive scenes asking the same question", () => {
  it("keeps the question on screen across the cut instead of hiding it for the next scene's lead-in", async () => {
    expect((await show(first, 9_900))?.textContent).toContain("Welches Upgrade brauchst du dringend?");
    const overlay = await show(second, 10_100);
    expect(overlay?.textContent).toContain("Welches Upgrade brauchst du dringend?");
    expect(overlay?.textContent).toContain("Mehr Energie");
    expect(overlay?.classList.contains("question-fade-out")).toBe(false);
  });

  it("still fades out and back in when the next scene asks something else", async () => {
    await show(first, 9_900);
    expect((await show(different, 10_100))?.classList.contains("question-fade-out")).toBe(true);
  });

  it("waits a moment past a scene's end before fading, so the next scene can take the question over", () => {
    expect(videoQuestionStage(first, 10_000 + SCENE_END_HANDOVER_MS - 1)).toBe("closed");
    expect(videoQuestionStage(first, 10_000 + SCENE_END_HANDOVER_MS)).toBe("hidden");
  });
});
