// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { QuestionResolvedMessage } from "@smartphonecracy/protocol";
import {
  SPECTRUM_DECISION_PLAYBACK_RATE,
  VOTE_DECISION_SOUND_DURATION_MS,
  VoteDecisionSound,
} from "./VoteDecisionSound.js";

class FakeAudio {
  static created: FakeAudio[] = [];
  preload = "";
  currentTime = 0;
  playbackRate = 1;
  preservesPitch = true;
  readonly pause = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly addEventListener = vi.fn();
  readonly play = vi.fn(async () => undefined);

  constructor(readonly src: string) {
    FakeAudio.created.push(this);
  }
}

const resolution = {
  t: "question_resolved",
  v: 2,
  sessionId: "session-1",
  phaseEpoch: 3,
  field: {
    type: "two-quadrant",
    axis: "x",
    variant: "split",
    labels: { minLabel: "left", maxLabel: "right" },
  },
} as QuestionResolvedMessage;

const spectrumResolution = {
  ...resolution,
  phaseEpoch: 4,
  field: {
    type: "two-quadrant",
    axis: "x",
    variant: "spectrum",
    labels: { minLabel: "left", maxLabel: "right" },
  },
} as QuestionResolvedMessage;

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  FakeAudio.created = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VoteDecisionSound", () => {
  it("plays a decision once and stops it after seven seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Audio", FakeAudio);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<VoteDecisionSound resolution={null} soundEnabled />));
    await act(async () => root?.render(<VoteDecisionSound resolution={resolution} soundEnabled />));

    expect(FakeAudio.created).toHaveLength(1);
    expect(FakeAudio.created[0]?.src).toContain("please%20cut%20me");
    expect(FakeAudio.created[0]?.play).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTime(VOTE_DECISION_SOUND_DURATION_MS));
    expect(FakeAudio.created[0]?.pause).toHaveBeenCalledOnce();
    expect(FakeAudio.created[0]?.removeAttribute).toHaveBeenCalledWith("src");
  });

  it("does not replay a missed decision when sound is enabled later", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<VoteDecisionSound resolution={resolution} soundEnabled={false} />));
    await act(async () => root?.render(<VoteDecisionSound resolution={resolution} soundEnabled />));
    expect(FakeAudio.created).toHaveLength(0);
  });

  it("ends continuous spectrum questions with a slightly lowered Ping4 instead of the gong", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<VoteDecisionSound resolution={spectrumResolution} soundEnabled />));

    expect(FakeAudio.created).toHaveLength(1);
    expect(FakeAudio.created[0]?.src).toContain("Ping4.mp3");
    expect(FakeAudio.created[0]?.src).not.toContain("please%20cut%20me");
    expect(FakeAudio.created[0]?.preservesPitch).toBe(false);
    expect(FakeAudio.created[0]?.playbackRate).toBe(SPECTRUM_DECISION_PLAYBACK_RATE);
    expect(FakeAudio.created[0]?.play).toHaveBeenCalledOnce();

    await act(async () => root?.render(<VoteDecisionSound
      resolution={{
        ...spectrumResolution,
        phaseEpoch: 5,
        field: {
          type: "four-quadrant",
          xAxis: { minLabel: "left", maxLabel: "right" },
          yAxis: { minLabel: "top", maxLabel: "bottom" },
        },
      } as QuestionResolvedMessage}
      soundEnabled
    />));

    expect(FakeAudio.created).toHaveLength(2);
    expect(FakeAudio.created[1]?.src).toContain("Ping4.mp3");
    expect(FakeAudio.created[1]?.preservesPitch).toBe(false);
    expect(FakeAudio.created[1]?.playbackRate).toBe(SPECTRUM_DECISION_PLAYBACK_RATE);
  });
});
