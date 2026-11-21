// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS, type PhaseSnapshotMessage, type ServerToClientMessage } from "@entertheblackbox/protocol";
import { App } from "./App.js";

const harness = vi.hoisted(() => ({
  receive: null as ((message: ServerToClientMessage) => void) | null,
  now: 5_000,
  store: {
    getBlobUrl: vi.fn(async (src: string) => `blob:${src}`),
    pin: vi.fn(),
  },
}));

vi.mock("./lib/connection.js", () => ({
  DisplayConnection: vi.fn(({ onMessage }: { onMessage: NonNullable<typeof harness.receive> }) => {
    harness.receive = onMessage;
    return { start: vi.fn(), stop: vi.fn(), send: vi.fn(), clock: {
      ready: true, now: () => harness.now, sampleAgeMs: () => null, localDelayUntil: () => 0,
    } };
  }),
}));
vi.mock("./lib/useDisplaySettings.js", () => ({ useDisplaySettings: () => DEFAULT_DISPLAY_SETTINGS }));
vi.mock("./lib/kiosk.js", () => ({ applyKioskGuards: () => () => {}, performReload: vi.fn() }));
vi.mock("./lib/heartbeat.js", () => ({ IDLE_PLACEHOLDER: "idle", startHeartbeat: () => () => {} }));
vi.mock("./cursors/realtimeWsClient.js", () => ({
  RealtimeWsClient: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));
vi.mock("./components/IdleAttract.js", () => ({ IdleAttract: () => null }));
vi.mock("./components/LobbyCountdown.js", () => ({ LobbyCountdown: () => null }));
vi.mock("./cursors/CursorCanvas.js", () => ({ CursorCanvas: () => null }));
vi.mock("./media/useMedia.js", () => ({
  useMedia: () => {
    const [media, setMedia] = useState({
      visualSrc: null as string | null,
      audioSrc: null as string | null,
      extraAudioSrc: null as string | null,
    });
    return {
      ...media,
      status: { state: "ready" },
      videoUrl: media.visualSrc && `blob:${media.visualSrc}`,
      audioUrl: media.audioSrc && `blob:${media.audioSrc}`,
      extraAudioUrl: media.extraAudioSrc && `blob:${media.extraAudioSrc}`,
      showMedia: (visualSrc: string | null, audioSrc: string | null, extraAudioSrc: string | null) =>
        setMedia({ visualSrc, audioSrc, extraAudioSrc }),
      store: harness.store,
    };
  },
}));

let root: Root;
let frameCallbacks: Map<HTMLVideoElement, VideoFrameRequestCallback>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  frameCallbacks = new Map();
  Object.defineProperties(HTMLVideoElement.prototype, {
    requestVideoFrameCallback: { configurable: true, value(this: HTMLVideoElement, callback: VideoFrameRequestCallback) {
      frameCallbacks.set(this, callback);
      return 1;
    } },
    cancelVideoFrameCallback: { configurable: true, value(this: HTMLVideoElement) { frameCallbacks.delete(this); } },
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => root.render(<App />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  Reflect.deleteProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback");
  Reflect.deleteProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback");
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const timing = { scenarioVersion: "show", startedAt: 1_000, deadlineAt: null };
const film = (src: string): Extract<PhaseSnapshotMessage, { kind: "video" }> => ({
  ...timing, kind: "video", id: src, src, expectedDurationMs: 10_000, next: "next",
});
const loop = (loopVideoSrc?: string): PhaseSnapshotMessage => ({
  ...timing, kind: "narration", id: loopVideoSrc ?? "blank", text: "", durationMs: 10_000, next: "next",
  ...(loopVideoSrc ? { loopVideoSrc } : {}),
});
const still = (src: string, loopVideoSrc?: string): PhaseSnapshotMessage => ({
  ...film(src), audioSrc: "cue.mp3", ...(loopVideoSrc ? { loopVideoSrc } : {}),
});
const phase = (epoch: number, snapshot: PhaseSnapshotMessage) => act(async () => harness.receive?.({
  t: "phase", v: 2, sessionId: "session", phaseEpoch: epoch, serverTime: harness.now, phase: snapshot,
}));
const video = (src: string) => document.querySelector<HTMLVideoElement>(`video[src="blob:${src}"]`)!;
const image = (src: string) => document.querySelector<HTMLImageElement>(`img[src="blob:${src}"]`)!;
const activeForeground = () => document.querySelector(".phase-video-slot-active video, .phase-video-slot-active img");
const activeLoop = () => document.querySelector(".phase-loop-video-active");

async function present(element: HTMLVideoElement) {
  Object.defineProperties(element, {
    readyState: { configurable: true, value: 2 },
    videoWidth: { configurable: true, value: 64 },
    videoHeight: { configurable: true, value: 36 },
    paused: { configurable: true, value: false },
    duration: { configurable: true, value: 20 },
  });
  await act(async () => {
    element.dispatchEvent(new Event("loadedmetadata"));
    element.dispatchEvent(new Event("playing"));
  });
  await act(async () => frameCallbacks.get(element)?.(0, { mediaTime: element.currentTime } as VideoFrameCallbackMetadata));
}

describe("projection loop handoffs", () => {
  it("keeps a film and then a loop visible until each replacement is presented", async () => {
    await phase(1, film("opening.mp4"));
    const opening = video("opening.mp4");
    await present(opening);
    expect(activeForeground()).toBe(opening);

    await phase(2, loop("first-loop.mp4"));
    const firstLoop = video("first-loop.mp4");
    expect(activeForeground()).toBe(opening);
    expect(activeLoop()).toBeNull();
    await present(firstLoop);
    // After a picture-only clip the loop dissolves in over its last frame, which stays until then.
    expect(activeLoop()).toBe(firstLoop);
    expect(firstLoop.style.animation).toContain("phase-loop-fade-in 500ms");
    expect(activeForeground()).toBe(opening);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    expect(activeForeground()).toBeNull();

    await phase(3, loop("second-loop.webm"));
    const secondLoop = video("second-loop.webm");
    expect(activeLoop()).toBe(firstLoop);
    await present(secondLoop);
    expect(activeLoop()).toBe(secondLoop);
    expect(video("first-loop.mp4")).toBeNull();

    await phase(4, loop());
    expect(activeLoop()).toBeNull();
    expect(video("second-loop.webm")).toBeNull();
  });

  it("keeps the curtain loop up through a group scene when no waiting video is set", async () => {
    await phase(1, loop("curtain.mp4"));
    const curtain = video("curtain.mp4");
    await present(curtain);
    await phase(2, { ...timing, kind: "group-branch", id: "split", durationMs: 5_000,
      assignment: { type: "self-select" }, branches: [{ groupId: "a", weight: 1 }], next: "monologue" });
    expect(document.querySelector('[aria-label="Display inactive"]')).toBeNull();
    expect(activeLoop()).toBe(curtain);

    // The next scene's film replaces it only once it has a frame.
    await phase(3, film("monologue.mp4"));
    expect(activeLoop()).toBe(curtain);
    await present(video("monologue.mp4"));
    expect(activeForeground()).toBe(video("monologue.mp4"));
  });

  it("waits for a fresh frame when a loop comes back after a film", async () => {
    await phase(1, loop("curtain.mp4"));
    await present(video("curtain.mp4"));
    await phase(2, film("qr-close.mp4"));
    const qrClose = video("qr-close.mp4");
    await present(qrClose);
    // A picture-only clip takes over with a short dissolve: the loop fades out on top, then leaves.
    expect((activeLoop() as HTMLVideoElement | null)?.style.opacity).toBe("0");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    expect(activeLoop()).toBeNull();

    // Same loop, same slot as before: the earlier element's frame must not count for the new one.
    await phase(3, loop("curtain.mp4"));
    const returning = video("curtain.mp4");
    expect(activeLoop()).toBeNull();
    expect(activeForeground()).toBe(qrClose);
    await present(returning);
    expect(activeLoop()).toBe(returning);
    // The closed curtain dissolves in over the closing's last frame.
    expect(activeForeground()).toBe(qrClose);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    expect(activeForeground()).toBeNull();
    expect(returning.style.animation).toBe("");
  });

  it("cuts straight to a loop after a film with its own sound", async () => {
    await phase(1, { ...film("monologue.mp4"), extraAudioSrc: "voice.mp3" });
    const monologue = video("monologue.mp4");
    await present(monologue);
    await phase(2, loop("qr-loop.mp4"));
    const qr = video("qr-loop.mp4");
    await present(qr);
    expect(activeLoop()).toBe(qr);
    expect(qr.style.animation).toBe("");
    expect(activeForeground()).toBeNull();
  });

  it("keeps a closing over a still + MP3 scene while its loop dissolves in", async () => {
    await phase(1, film("qr-close.mp4"));
    const qrClose = video("qr-close.mp4");
    await present(qrClose);
    await phase(2, still("black.jpg", "curtain.mp4"));
    const curtain = video("curtain.mp4");
    await present(curtain);
    const incoming = image("black.jpg");
    await act(async () => incoming.dispatchEvent(new Event("load")));
    // The sound starts now; the still waits under the closing's last frame.
    expect(activeForeground()).toBe(incoming);
    expect(activeLoop()).toBe(curtain);
    expect(curtain.style.animation).toContain("phase-loop-fade-in 500ms");
    expect(document.querySelector(".phase-video-slot-held video")).toBe(qrClose);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    expect(video("qr-close.mp4")).toBeNull();
    expect(activeForeground()).toBe(incoming);
  });

  it("keeps a shared loop mounted across cues with a new still under it", async () => {
    await phase(1, loop("alpha.webm"));
    const overlay = video("alpha.webm");
    await present(overlay);
    await phase(2, still("new.jpg", "alpha.webm"));
    expect(activeLoop()).toBe(overlay);
    expect(activeForeground()).toBeNull();
    expect(document.querySelector('audio[src="blob:cue.mp3"]')).not.toBeNull();
    const incoming = image("new.jpg");
    await act(async () => incoming.dispatchEvent(new Event("load")));
    expect(activeForeground()).toBe(incoming);
    expect(activeLoop()).toBe(overlay);
  });

  it("switches both layers together for a new loop over a still and ignores superseded frames", async () => {
    await phase(1, film("old.mp4"));
    const outgoing = video("old.mp4");
    await present(outgoing);
    await phase(2, loop("stale.mp4"));
    const stale = video("stale.mp4");
    Object.defineProperty(stale, "duration", { value: 20 });
    await act(async () => stale.dispatchEvent(new Event("playing")));
    const staleFrame = frameCallbacks.get(stale);

    await phase(3, still("new.jpg", "new-alpha.webm"));
    const overlay = video("new-alpha.webm");
    await present(overlay);
    await act(async () => staleFrame?.(0, { mediaTime: 5 } as VideoFrameCallbackMetadata));
    expect(activeForeground()).toBe(outgoing);
    expect(activeLoop()).toBeNull();

    const incoming = image("new.jpg");
    await act(async () => incoming.dispatchEvent(new Event("load")));
    expect(activeForeground()).toBe(incoming);
    expect(activeLoop()).toBe(overlay);
    expect(video("old.mp4")).toBeNull();
  });
});
