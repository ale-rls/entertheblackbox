// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

const harness = vi.hoisted(() => {
  const connection = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    currentStatus: "closed",
    clock: { now: () => Date.now() },
  };
  return {
    connection,
    mediaStatus: { state: "idle" } as
      | { state: "idle" }
      | { state: "ready" },
    showMedia: vi.fn(),
    realtimeStart: vi.fn(),
    realtimeStop: vi.fn(),
    realtimeOptions: null as null | {
      onSnapshot: (cursors: ReadonlyArray<{ clientId: string; color: string; x: number; y: number }>) => void;
      onUpdate: (cursor: { clientId: string; color: string; x: number; y: number }) => void;
      onLeave: (clientId: string) => void;
    },
    cursorField: null as null | { size: number },
  };
});

vi.mock("./lib/connection.js", () => ({
  DisplayConnection: vi.fn(() => harness.connection),
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
    videoUrl: null,
    audioUrl: null,
    showMedia: harness.showMedia,
    store: {},
  }),
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
  IdleAttract: () => <div data-testid="idle-attract">idle attract</div>,
}));
vi.mock("./components/LobbyCountdown.js", () => ({ LobbyCountdown: () => null }));
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
});

describe("App media-readiness gate", () => {
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
});
