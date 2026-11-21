// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerClock } from "../lib/serverClock.js";
import { SceneCountdown } from "./SceneCountdown.js";

class FakeAudio {
  static created: FakeAudio[] = [];
  preload = "";
  currentTime = 0;
  readonly pause = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly play = vi.fn(async () => undefined);
  constructor(readonly src: string) { FakeAudio.created.push(this); }
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

async function render(nowMs: number, belowText = false) {
  vi.stubGlobal("Audio", FakeAudio);
  const clock = { now: () => nowMs } as unknown as ServerClock;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root?.render(<SceneCountdown countdown={{ startAtMs: 5_000, endAtMs: 30_000, pingSeconds: 5 }} startedAt={0} clock={clock} soundEnabled belowText={belowText} />));
}

describe("SceneCountdown", () => {
  it("shows the seconds left without pinging before the ping window", async () => {
    await render(10_000);
    expect(document.querySelector(".scene-countdown")?.textContent).toBe("20");
    expect(FakeAudio.created).toHaveLength(0);
  });

  it("pings Ping4 inside the final seconds and sits below narration text", async () => {
    await render(26_500, true);
    expect(document.querySelector(".scene-countdown-below")?.textContent).toBe("4");
    expect(FakeAudio.created[0]?.src).toContain("Ping4.mp3");
    expect(FakeAudio.created[0]?.play).toHaveBeenCalledOnce();
  });

  it("is hidden outside its window", async () => {
    await render(4_000);
    expect(document.querySelector(".scene-countdown")).toBeNull();
  });

  it("shows an amount counting down instead of seconds, pinging by seconds", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const clock = { now: () => 30_000 } as unknown as ServerClock;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<SceneCountdown countdown={{ startAtMs: 0, endAtMs: 60_000, pingSeconds: 5, countFrom: 2_000_000 }} startedAt={0} clock={clock} soundEnabled />));
    const shown = document.querySelector(".vote-close-countdown");
    expect(shown?.textContent).toBe("1.000.000");
    expect(shown?.classList.contains("countdown-amount")).toBe(true);
    expect(FakeAudio.created).toHaveLength(0);
  });
});
