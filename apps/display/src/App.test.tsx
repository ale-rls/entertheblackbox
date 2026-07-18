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
    showVideo: vi.fn(),
  };
});

vi.mock("./lib/connection.js", () => ({
  DisplayConnection: vi.fn(() => harness.connection),
}));

vi.mock("./media/useMedia.js", () => ({
  useMedia: () => ({
    status: harness.mediaStatus,
    videoUrl: null,
    showVideo: harness.showVideo,
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
vi.mock("./components/PhoneCount.js", () => ({ PhoneCount: () => null }));
vi.mock("./cursors/CursorCanvas.js", () => ({ CursorCanvas: () => null }));

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
  harness.showVideo.mockClear();
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
});
