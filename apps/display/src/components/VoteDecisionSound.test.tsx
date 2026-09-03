// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { QuestionResolvedMessage } from "@smartphonecracy/protocol";
import { VOTE_DECISION_SOUND_DURATION_MS, VoteDecisionSound } from "./VoteDecisionSound.js";

class FakeAudio {
  static created: FakeAudio[] = [];
  preload = "";
  currentTime = 0;
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
});
