// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerClock } from "../lib/serverClock.js";
import { VoteCloseCountdown } from "./VoteCloseCountdown.js";

class FakeAudio {
  static created: FakeAudio[] = [];
  preload = "";
  currentTime = 4;
  readonly pause = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly play = vi.fn(async () => undefined);

  constructor(readonly src: string) {
    FakeAudio.created.push(this);
  }
}

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  FakeAudio.created = [];
  vi.unstubAllGlobals();
});

describe("VoteCloseCountdown", () => {
  it("uses Ping4 for a visible countdown tick", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const clock = { remainingUntil: () => 2_000 } as unknown as ServerClock;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<VoteCloseCountdown clock={clock} deadlineAt={10_000} soundEnabled center={{ x: 47, y: 65 }} />));

    expect(document.querySelector(".vote-close-countdown")?.getAttribute("style")).toContain("left: 47%");
    expect(FakeAudio.created).toHaveLength(1);
    expect(FakeAudio.created[0]?.src).toContain("Ping4.mp3");
    expect(FakeAudio.created[0]?.currentTime).toBe(0);
    expect(FakeAudio.created[0]?.play).toHaveBeenCalledOnce();
  });

  it("runs a 12 s countdown when the vote names 12 seconds", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const clock = { remainingUntil: () => 11_400 } as unknown as ServerClock;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<VoteCloseCountdown clock={clock} deadlineAt={20_000} soundEnabled={false} durationSeconds={12} />));
    expect(document.querySelector(".vote-close-countdown")?.textContent).toBe("12");

    await act(async () => root?.render(<VoteCloseCountdown clock={clock} deadlineAt={20_000} soundEnabled={false} durationSeconds={10} />));
    expect(document.querySelector(".vote-close-countdown")).toBeNull();
  });

  it("shows a 60 s countdown the whole minute but pings only in its last 5 seconds", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    let remaining = 42_300;
    const clock = { remainingUntil: () => remaining } as unknown as ServerClock;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<VoteCloseCountdown clock={clock} deadlineAt={60_000} soundEnabled durationSeconds={60} />));
    expect(document.querySelector(".vote-close-countdown")?.textContent).toBe("43");
    expect(FakeAudio.created).toHaveLength(0);

    remaining = 4_200;
    await act(async () => root?.render(<VoteCloseCountdown clock={clock} deadlineAt={60_001} soundEnabled durationSeconds={60} />));
    expect(document.querySelector(".vote-close-countdown")?.textContent).toBe("5");
    expect(FakeAudio.created[0]?.play).toHaveBeenCalledOnce();
  });
});
