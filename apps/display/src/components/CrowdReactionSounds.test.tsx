// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RatingStatusMessage } from "@smartphonecracy/protocol";
import { CrowdReactionSounds, pickReactionSample } from "./CrowdReactionSounds.js";

class FakeAudio {
  static created: FakeAudio[] = [];
  preload = "";
  volume = 1;
  readonly pause = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly addEventListener = vi.fn();
  readonly play = vi.fn(async () => undefined);

  constructor(readonly src: string) {
    FakeAudio.created.push(this);
  }
}

const status = (applause: number, boo: number): RatingStatusMessage => ({
  t: "rating_status",
  v: 2,
  sessionId: "session-1",
  phaseEpoch: 4,
  candidateLabel: "OpenApollo",
  applause,
  boo,
});

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  FakeAudio.created = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CrowdReactionSounds", () => {
  it("plays a crowd sample for new reactions without rendering a score", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(Math, "random").mockReturnValue(0);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<CrowdReactionSounds status={status(0, 0)} soundEnabled />));
    expect(FakeAudio.created).toHaveLength(0);

    await act(async () => root?.render(<CrowdReactionSounds status={status(2, 0)} soundEnabled />));
    expect(FakeAudio.created).toHaveLength(1);
    expect(FakeAudio.created[0]?.src).toContain("crowd-applause-01.mp3");
    expect(FakeAudio.created[0]?.play).toHaveBeenCalledOnce();
    expect(document.querySelector(".rating-meter")).toBeNull();

    await act(async () => root?.render(<CrowdReactionSounds status={status(2, 1)} soundEnabled />));
    expect(FakeAudio.created[1]?.src).toContain("crowd-boo-01.mp3");
  });

  it("does not replay reactions that arrived before display sound was unlocked", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<CrowdReactionSounds status={status(0, 0)} soundEnabled={false} />));
    await act(async () => root?.render(<CrowdReactionSounds status={status(3, 1)} soundEnabled={false} />));
    await act(async () => root?.render(<CrowdReactionSounds status={status(3, 1)} soundEnabled />));
    expect(FakeAudio.created).toHaveLength(0);
  });

  it("selects different samples from the reaction pools", () => {
    expect(pickReactionSample("applause", () => 0)).toContain("applause-01");
    expect(pickReactionSample("applause", () => 0.99)).toContain("applause-03");
    expect(pickReactionSample("boo", () => 0.5)).toContain("boo-02");
  });
});
