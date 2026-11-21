// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS, PROTOCOL_VERSION, type ServerToClientMessage } from "@entertheblackbox/protocol";
import type { PhaseVideoCandidate } from "./components/PhaseVideoHandoff.js";
import { App } from "./App.js";

const harness = vi.hoisted(() => {
  const connection = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    currentStatus: "closed",
    clock: { now: () => Date.now(), sampleAgeMs: () => null },
  };
  return {
    waitingVideoUrl: "",
    connection,
    mediaStatus: { state: "idle" } as
      | { state: "idle" }
      | { state: "ready" },
    visualSrc: null as string | null,
    audioSrc: null as string | null,
    extraAudioSrc: null as string | null,
    videoUrl: null as string | null,
    audioUrl: null as string | null,
    extraAudioUrl: null as string | null,
    showMedia: vi.fn(),
    connectionOptions: null as null | { onMessage: (message: ServerToClientMessage) => void },
    videoCandidate: null as PhaseVideoCandidate | null,
    realtimeStart: vi.fn(),
    realtimeStop: vi.fn(),
    realtimeOptions: null as null | {
      onSnapshot: (cursors: ReadonlyArray<{ clientId: string; color: string; x: number; y: number }>) => void;
      onUpdate: (cursor: { clientId: string; color: string; x: number; y: number }) => void;
      onLeave: (clientId: string) => void;
    },
    cursorField: null as null | { size: number },
    store: { pin: vi.fn(), getBlobUrl: vi.fn(async (src: string) => `blob:${src}`) },
  };
});

vi.mock("./lib/useDisplaySettings.js", () => ({
  useDisplaySettings: () => ({ ...DEFAULT_DISPLAY_SETTINGS, waitingVideoUrl: harness.waitingVideoUrl }),
}));

vi.mock("./lib/connection.js", () => ({
  DisplayConnection: vi.fn((options: NonNullable<typeof harness.connectionOptions>) => {
    harness.connectionOptions = options;
    return harness.connection;
  }),
}));

vi.mock("./cursors/realtimeWsClient.js", () => ({
  RealtimeWsClient: vi.fn((options: NonNullable<typeof harness.realtimeOptions>) => {
    harness.realtimeOptions = options;
    return { start: harness.realtimeStart, stop: harness.realtimeStop };
  }),
}));

vi.mock("./media/useMedia.js", () => ({
  useMedia: () => ({
    status: harness.mediaStatus,
    visualSrc: harness.visualSrc,
    audioSrc: harness.audioSrc,
    extraAudioSrc: harness.extraAudioSrc,
    videoUrl: harness.videoUrl,
    audioUrl: harness.audioUrl,
    extraAudioUrl: harness.extraAudioUrl,
    showMedia: harness.showMedia,
    store: harness.store,
  }),
}));

vi.mock("./components/PhaseVideoHandoff.js", () => ({
  PhaseVideoHandoff: ({ candidate }: { candidate: PhaseVideoCandidate | null }) => {
    harness.videoCandidate = candidate;
    return null;
  },
}));

vi.mock("./lib/kiosk.js", () => ({
  applyKioskGuards: vi.fn(() => vi.fn()),
  performReload: vi.fn(),
}));

vi.mock("./lib/heartbeat.js", () => ({
  IDLE_PLACEHOLDER: "idle",
  startHeartbeat: vi.fn(() => vi.fn()),
}));

vi.mock("./components/IdleAttract.js", () => ({
  IdleAttract: ({ videoUrls, mediaVisible, qrHidden }: { videoUrls?: string[]; mediaVisible?: boolean; qrHidden: boolean }) => <div data-testid="idle-attract" data-url={videoUrls?.[0]} data-visible={mediaVisible} data-qr-hidden={qrHidden}>idle attract</div>,
}));
vi.mock("./components/LobbyCountdown.js", () => ({ LobbyCountdown: () => null }));
const curtainStageProps: { dimFrom?: number }[] = [];
vi.mock("./curtain/CurtainStage.js", () => ({
  CURTAIN_LEAVE_MS: 1_200,
  CurtainStage: (props: { dimFrom?: number }) => { curtainStageProps.push(props); return null; },
}));
vi.mock("./cursors/CursorCanvas.js", () => ({
  CursorCanvas: ({ field }: { field: { size: number } }) => {
    harness.cursorField = field;
    return null;
  },
}));

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  harness.connection.start.mockClear();
  harness.connection.stop.mockClear();
  harness.connection.send.mockClear();
  harness.showMedia.mockClear();
  harness.realtimeStart.mockClear();
  harness.realtimeStop.mockClear();
  harness.realtimeOptions = null;
  harness.cursorField = null;
  harness.mediaStatus = { state: "idle" };
  harness.visualSrc = null;
  harness.audioSrc = null;
  harness.extraAudioSrc = null;
  harness.videoUrl = null;
  harness.audioUrl = null;
  harness.extraAudioUrl = null;
  harness.connectionOptions = null;
  harness.videoCandidate = null;
  harness.store.pin.mockClear();
  harness.store.getBlobUrl.mockClear();
  harness.waitingVideoUrl = "";
});

describe("App media-readiness gate", () => {
  it("suppresses the idle join QR on the normal projection", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));
    expect(document.querySelector('[data-testid="idle-attract"]')?.getAttribute("data-qr-hidden")).toBe("true");
    expect(document.querySelector(".qr-badge")).toBeNull();
  });
  it("unmounts all media, QR, controls and cursors while group paths own the show, then resumes shared rendering", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));
    await act(async () => harness.connectionOptions!.onMessage({
      t: "phase", v: PROTOCOL_VERSION, sessionId: "session", phaseEpoch: 10, serverTime: 0,
      phase: { kind: "group-branch", id: "split", title: "Choose a group", durationMs: 1_000,
        assignment: { type: "self-select" }, branches: [{ groupId: "a", weight: 1 }, { groupId: "b", weight: 1 }], next: "idle",
        scenarioVersion: "test", startedAt: 0, deadlineAt: 1_000 },
    }));
    expect(document.querySelector('[aria-label="Display inactive"]')).not.toBeNull();
    expect(document.querySelector(".display-root")!.children).toHaveLength(0);
    expect(harness.showMedia).toHaveBeenLastCalledWith(null, null, null);
    await act(async () => harness.connectionOptions!.onMessage({
      t: "phase", v: PROTOCOL_VERSION, sessionId: "idle", phaseEpoch: 11, serverTime: 1_000,
      phase: { kind: "idle", id: "idle", scenarioVersion: "test", startedAt: 1_000, deadlineAt: null },
    }));
    expect(document.querySelector('[aria-label="Display inactive"]')).toBeNull();
    expect(document.querySelector('[data-testid="idle-attract"]')).not.toBeNull();
  });
  it("keeps the ?clock=1 overlay on an inactive group display", async () => {
    history.replaceState(null, "", "/display/?clock=1&group=theater");
    try {
      vi.resetModules();
      const { App: GroupApp } = await import("./App.js");
      document.body.innerHTML = '<div id="root"></div>';
      root = createRoot(document.querySelector("#root")!);
      await act(async () => root?.render(<GroupApp />));
      expect(document.querySelector('[aria-label="Display inactive"]')).not.toBeNull();
      expect(document.body.textContent).toContain("No cue");
    } finally {
      history.replaceState(null, "", "/");
      vi.resetModules();
    }
  });
  it("updates the lobby URL live and shows it while group paths own the show", async () => {
    harness.waitingVideoUrl = "/media/lobby.mp4";
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));
    expect(document.querySelector('[data-testid="idle-attract"]')?.getAttribute("data-url")).toBe("/media/lobby.mp4");
    harness.waitingVideoUrl = "/media/replacement.mp4";
    await act(async () => root?.render(<App />));
    expect(document.querySelector('[data-testid="idle-attract"]')?.getAttribute("data-url")).toBe("/media/replacement.mp4");
    await act(async () => harness.connectionOptions!.onMessage({
      t: "phase", v: PROTOCOL_VERSION, sessionId: "session", phaseEpoch: 10, serverTime: 0,
      phase: { kind: "group-branch", id: "split", durationMs: 1000,
        assignment: { type: "self-select" }, branches: [{ groupId: "a", weight: 1 }], next: "idle",
        scenarioVersion: "test", startedAt: 0, deadlineAt: 1000 },
    }));
    expect(document.querySelector('[aria-label="Display inactive"] [data-testid="idle-attract"]')?.getAttribute("data-url")).toBe("/media/replacement.mp4");
    expect(document.querySelector(".sound-control")).toBeNull();
  });
  it("keeps the idle preparation UI offline, then connects once media is ready", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<App />));

    expect(harness.connection.start).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="idle-attract"]')).not.toBeNull();
    expect(document.querySelector(".media-status")?.textContent).toBe("preparing media…");
    expect(document.querySelector(".reconnecting")).toBeNull();

    harness.mediaStatus = { state: "ready" };
    await act(async () => root?.render(<App />));

    expect(harness.connection.start).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".media-status")).toBeNull();
    expect(document.querySelector(".reconnecting")?.textContent).toBe("reconnecting…");
  });

  it("stops a ready connection when the display unmounts", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);

    await act(async () => root?.render(<App />));
    expect(harness.connection.start).toHaveBeenCalledTimes(1);

    await act(async () => root?.unmount());
    root = null;
    expect(harness.connection.stop).toHaveBeenCalledTimes(1);
  });

  it("ingests realtime cursor positions while the waiting room is idle", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));

    expect(harness.cursorField?.size).toBe(0);
    harness.realtimeOptions?.onSnapshot([
      { clientId: "p1", color: "#ff00aa", x: 0.25, y: 0.75 },
    ]);
    expect(harness.cursorField?.size).toBe(1);
  });

  it("hides the one-way sound unlock after the user gesture", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));

    const button = document.querySelector<HTMLButtonElement>(".sound-control")!;
    expect(button.textContent).toBe("Enable sound");

    await act(async () => button.click());
    expect(document.querySelector(".sound-control")).toBeNull();
  });

  it("waits for the matching extra audio when consecutive phases share one video", async () => {
    harness.mediaStatus = { state: "ready" };
    harness.visualSrc = "shared-loop.mp4";
    harness.audioSrc = null;
    harness.extraAudioSrc = "question-1.mp3";
    harness.videoUrl = "blob:shared-loop";
    harness.extraAudioUrl = "blob:question-1";
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));

    await act(async () => {
      harness.connectionOptions?.onMessage({
        t: "snapshot",
        v: PROTOCOL_VERSION,
        sessionId: "session-1",
        phaseEpoch: 2,
        serverTime: 0,
        phase: {
          kind: "video",
          id: "question-2",
          src: "shared-loop.mp4",
          extraAudioSrc: "question-2.mp3",
          expectedDurationMs: 10_000,
          next: "question-3",
          scenarioVersion: "show-1",
          startedAt: 0,
          deadlineAt: null,
        },
      });
    });

    expect(harness.videoCandidate).toBeNull();

    harness.extraAudioSrc = "question-2.mp3";
    harness.extraAudioUrl = "blob:question-2";
    await act(async () => root?.render(<App />));

    expect(harness.videoCandidate?.extraAudioSrc).toBe("blob:question-2");
  });

  it("renders an opted-in video title with the centered XL treatment", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));

    await act(async () => {
      harness.connectionOptions?.onMessage({
        t: "snapshot",
        v: PROTOCOL_VERSION,
        sessionId: "session-1",
        phaseEpoch: 1,
        serverTime: 0,
        phase: {
          kind: "video",
          id: "centered-title",
          title: "A centered statement",
          titleLayout: "centered-xl",
          src: "statement.mp4",
          expectedDurationMs: 10_000,
          next: "idle",
          scenarioVersion: "show-1",
          startedAt: 0,
          deadlineAt: null,
        },
      });
    });

    const title = document.querySelector(".video-title");
    expect(title?.textContent).toBe("A centered statement");
    expect(title?.classList.contains("video-title-centered-xl")).toBe(true);
  });

  it("sets a narration title at the top only when the scene asks for it", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));
    const send = async (phaseEpoch: number, phase: Record<string, unknown>) => act(async () => {
      harness.connectionOptions?.onMessage({
        t: "snapshot", v: PROTOCOL_VERSION, sessionId: "session-1", phaseEpoch, serverTime: 0,
        phase: { scenarioVersion: "show-1", startedAt: 0, deadlineAt: null, durationMs: 10_000, next: "idle", ...phase },
      } as ServerToClientMessage);
    });

    await send(1, { kind: "narration", id: "closed", title: "2. Trainingsepoche", text: "REGIE" });
    expect(document.querySelector(".narration")?.classList.contains("narration-top")).toBe(false);

    await send(2, { kind: "narration", id: "open", title: "2. Trainingsepoche", text: "REGIE", titleLayout: "top" });
    expect(document.querySelector(".narration")?.classList.contains("narration-top")).toBe(true);
    expect(document.querySelector(".narration-text")?.textContent).toBe("REGIE");
  });

  it("loops a scene's background video and keeps it until the next scene's video is presented", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));
    const send = async (phaseEpoch: number, phase: Record<string, unknown>) => act(async () => {
      harness.connectionOptions?.onMessage({
        t: "snapshot", v: PROTOCOL_VERSION, sessionId: "session-1", phaseEpoch, serverTime: 0,
        phase: { scenarioVersion: "show-1", startedAt: 0, deadlineAt: null, ...phase },
      } as ServerToClientMessage);
    });

    await send(1, { kind: "narration", id: "hold", text: "ARBEIT", loopVideoSrc: "curtain-loop.mp4", durationMs: 10_000, next: "opening" });
    const loop = document.querySelector<HTMLVideoElement>("video.phase-loop-video");
    expect(loop?.getAttribute("src")).toBe("blob:curtain-loop.mp4");
    expect(loop?.muted).toBe(true);
    expect(harness.store.pin).toHaveBeenCalledWith("curtain-loop.mp4", "loop");
    // A loop goes on screen once it has a decoded frame.
    Object.defineProperties(loop!, {
      readyState: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 64 },
      paused: { configurable: true, value: false },
    });
    await act(async () => { loop!.dispatchEvent(new Event("loadeddata")); });
    expect(loop?.classList.contains("phase-loop-video-active")).toBe(true);

    // The opening video is not presented yet: the curtain loop stays up.
    await send(2, { kind: "video", id: "opening", src: "curtain-open.mp4", expectedDurationMs: 10_000, next: "idle" });
    expect(document.querySelector("video.phase-loop-video-active")).toBe(loop);
  });

  it("dims the background behind a title to the vote's level, and back up after it", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      await act(async () => root?.render(<App />));
      const send = async (phaseEpoch: number, phase: Record<string, unknown>) => act(async () => {
        harness.connectionOptions?.onMessage({
          t: "snapshot", v: PROTOCOL_VERSION, sessionId: "session-1", phaseEpoch, serverTime: 0,
          phase: { scenarioVersion: "show-1", startedAt: 0, deadlineAt: null, ...phase },
        } as ServerToClientMessage);
      });
      const layer = () => document.querySelector<HTMLElement>(".layer-video")!;
      const settle = async () => act(async () => { vi.advanceTimersByTime(1_100); });

      // A blank scene over the loop (only there to hold the curtain) stays bright.
      await send(1, { kind: "narration", id: "hold", text: " ", loopVideoSrc: "curtain-loop.mp4", durationMs: 10_000, next: "title" });
      const loop = document.querySelector<HTMLVideoElement>("video.phase-loop-video")!;
      Object.defineProperties(loop, {
        readyState: { configurable: true, value: 2 },
        videoWidth: { configurable: true, value: 64 },
        paused: { configurable: true, value: false },
      });
      await act(async () => { loop.dispatchEvent(new Event("loadeddata")); });
      await settle();
      expect(layer().style.filter).toBe("");

      await send(2, { kind: "narration", id: "title", title: "1. Trainingsepoche", text: "THEATERBESUCH", loopVideoSrc: "curtain-loop.mp4", durationMs: 10_000, next: "film" });
      await settle();
      expect(layer().style.filter).toBe("url(#title-dim)");
      const table = document.querySelector("#title-dim feFuncR")?.getAttribute("tableValues")?.split(" ").map(Number);
      expect(table?.[0]).toBe(0);
      expect(table?.at(-1)).toBeLessThan(0.9);

      // A curtain vote straight after the title keeps the loop dimmed under the lit curtain.
      await send(3, { kind: "position-question", id: "vote", text: "Wie?", field: { type: "two-quadrant", axis: "x", variant: "split", labels: { minLabel: "a", maxLabel: "b" } },
        voteTreatment: { type: "curtain-light", curtain: { src: "curtain.mp4", baked: 0.31, folds: 0, shine: 0, shadow: 0, poolBase: 0, poolGain: 0, cursorFlood: 0, cursorFloodCounted: 0, neutralGap: 0 }, answerColors: {} },
        next: "film" });
      await settle();
      expect(layer().style.filter).toBe("url(#title-dim)");
      // The lit curtain starts at the title's level instead of dimming in from the plain curtain.
      expect(curtainStageProps.at(-1)?.dimFrom).toBeCloseTo(0.31);

      await send(4, { kind: "video", id: "film", src: "film.mp4", expectedDurationMs: 10_000, next: "idle" });
      await settle();
      expect(layer().style.filter).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dims into a title before the cut, stays dimmed between titles, and holds it through a closing", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(0);
    try {
      await act(async () => root?.render(<App />));
      const send = async (phaseEpoch: number, phase: Record<string, unknown>) => act(async () => {
        harness.connectionOptions?.onMessage({
          t: "snapshot", v: PROTOCOL_VERSION, sessionId: "session-1", phaseEpoch, serverTime: Date.now(),
          phase: { scenarioVersion: "show-1", startedAt: Date.now(), deadlineAt: null, ...phase },
        } as ServerToClientMessage);
      });
      const dimmed = () => document.querySelector<HTMLElement>(".layer-video")!.style.filter === "url(#title-dim)";
      // Two steps: a timer that fires in the first one starts the fade, which runs in the second.
      const advance = async (ms: number) => {
        await act(async () => { vi.advanceTimersByTime(ms - 300); });
        await act(async () => { vi.advanceTimersByTime(300); });
      };
      const title = { kind: "narration", text: "THEATERARBEIT", loopVideoSrc: "curtain-loop.mp4", durationMs: 6_000 };

      // A scene before a title dims during its last second.
      await send(1, { kind: "video", id: "before", src: "a.webp", audioSrc: "a.mp3", loopVideoSrc: "curtain-loop.mp4", expectedDurationMs: 10_000, next: "title", nextTitleBackdrop: true });
      await advance(8_500);
      expect(dimmed()).toBe(false);
      await advance(1_000);
      expect(dimmed()).toBe(true);

      await send(2, { ...title, id: "title", next: "between" });
      await advance(1_100);
      expect(dimmed()).toBe(true);

      // A scene between two titles stays dimmed.
      await send(3, { kind: "video", id: "between", src: "a.webp", audioSrc: "b.mp3", loopVideoSrc: "curtain-loop.mp4", expectedDurationMs: 10_000, next: "last-title", nextTitleBackdrop: true });
      await advance(1_100);
      expect(dimmed()).toBe(true);

      await send(4, { ...title, id: "last-title", next: "closing" });
      await advance(1_100);

      // A curtain closing after a title keeps the dim and lifts it in its last second.
      await send(5, { kind: "video", id: "closing", src: "curtain-close.mp4", expectedDurationMs: 12_000, next: "after" });
      await advance(1_100);
      expect(dimmed()).toBe(true);
      await advance(9_000);
      expect(dimmed()).toBe(true);
      await advance(1_200);
      await advance(1_100);
      expect(dimmed()).toBe(false);

      // A scene with sound after a title brightens from its start.
      await send(6, { ...title, id: "title-2", next: "talk" });
      await advance(1_100);
      await send(7, { kind: "video", id: "talk", src: "a.webp", audioSrc: "c.mp3", loopVideoSrc: "curtain-loop.mp4", expectedDurationMs: 30_000, next: "idle" });
      await advance(1_100);
      expect(dimmed()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a loop video on a scene whose own video would cover it", async () => {
    harness.mediaStatus = { state: "ready" };
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<App />));
    await act(async () => {
      harness.connectionOptions?.onMessage({
        t: "snapshot", v: PROTOCOL_VERSION, sessionId: "session-1", phaseEpoch: 1, serverTime: 0,
        phase: { kind: "video", id: "film", src: "film.mp4", loopVideoSrc: "curtain-loop.mp4", expectedDurationMs: 10_000, next: "idle", scenarioVersion: "show-1", startedAt: 0, deadlineAt: null },
      } as ServerToClientMessage);
    });
    expect(document.querySelector("video.phase-loop-video")).toBeNull();
    expect(harness.store.pin).not.toHaveBeenCalled();
  });
});
