// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PhoneConnectionOptions } from "./lib/connection.js";
import type { ServerToClientMessage } from "@entertheblackbox/protocol";
import { App } from "./App.js";

const mock = vi.hoisted(() => ({ options: null as PhoneConnectionOptions | null, send: vi.fn() }));
vi.mock("./lib/connection.js", () => ({ PhoneConnection: class {
  clock = { now: () => Date.now() };
  constructor(options: PhoneConnectionOptions) { mock.options = options; }
  start() {} stop() {} send = mock.send;
} }));
vi.mock("./lib/realtimeWsClient.js", () => ({ RealtimeCursorPublisher: class { start() {} stop() {} send() {} } }));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); localStorage.setItem("participant-name", "Visitor");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ installationId: "venue", roomId: "room", audioEnabled: true }) })));
  mock.send.mockClear(); mock.options = null;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<App />));
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function receive(message: ServerToClientMessage) { await act(async () => mock.options!.onMessage(message)); }
async function drag() {
  const trackpad = host.querySelector(".trackpad")! as HTMLDivElement;
  trackpad.setPointerCapture = vi.fn();
  await act(async () => {
    trackpad.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    trackpad.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 140, clientY: 120 }));
    trackpad.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 140, clientY: 120 }));
  });
}
it("sends cursor positions to the authoritative session and stops after voting closes without playing audio", async () => {
  await receive({ t: "phase", v: 2, sessionId: "show", phaseEpoch: 1, serverTime: 1000,
    phase: { id: "intro", kind: "video", src: "video.mp4", startedAt: 1000, expectedDurationMs: 10000, scenarioVersion: "v1", deadlineAt: 11000, next: "end", phoneAudioMode: "synchronized", phoneAudioSrc: "voice.mp3" } });
  await drag();
  expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ t: "input", sessionId: "show", phaseEpoch: 1, x: expect.any(Number), y: expect.any(Number) }));
  expect(host.querySelector("audio")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  await receive({ t: "voting_options", v: 2, sessionId: "show", phaseEpoch: 1, method: "phone-cursor", closed: true, question: "Choose", options: [] });
  mock.send.mockClear(); await drag(); expect(mock.send).not.toHaveBeenCalled();
});
it("explains native-only admission requirements without reloading", async () => {
  await receive({ t: "reload", v: 2, reason: "assets", minVersion: "Update the native app for participant tasks and admission programs" });
  await receive({ t: "join_rejected", v: 2, reason: "update_required" });
  expect(host.textContent).toContain("requires the native app");
});

it("sends fresh finger anchors for every curtain-light touch", async () => {
  await receive({ t: "phase", v: 2, sessionId: "show", phaseEpoch: 2, serverTime: 1000,
    phase: { id: "vote", kind: "video", src: "video.mp4", startedAt: 1000, expectedDurationMs: 10000,
      scenarioVersion: "v1", deadlineAt: 11000, next: "end",
      voteTreatment: { type: "curtain-light", answerColors: {}, entry: null,
        curtain: { src: "curtain.png", baked: 0, folds: 1, shine: 1, shadow: 1, poolBase: 1, poolGain: 1, cursorFlood: 1, cursorFloodCounted: 1, neutralGap: 0 } } } });
  const pad = host.querySelector(".trackpad")!;
  vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
  await drag(); await drag();
  const starts = mock.send.mock.calls.map(([message]) => message).filter(message => message.touch === "start");
  expect(starts).toHaveLength(2);
  expect(starts[0]).toMatchObject({ x: .5, y: .5, phaseEpoch: 2 });
  expect(starts[1]).toMatchObject({ x: .5, y: .5, phaseEpoch: 2 });
});

it("shows its own cursor where the server says it is during curtain-light votes", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (paint: FrameRequestCallback) => frames.push(paint));
  const paint = () => { for (const frame of frames.splice(0)) frame(0); };
  await receive({ t: "identity", v: 2, clientId: "visitor", color: "#ff595e", sessionId: "show", participantLease: "lease", leaseExpiresAt: 1e12 });
  const curtainVote = (phaseEpoch: number): ServerToClientMessage => ({ t: "phase", v: 2, sessionId: "show", phaseEpoch, serverTime: 1000,
    phase: { id: `vote-${phaseEpoch}`, kind: "video", src: "video.mp4", startedAt: 1000, expectedDurationMs: 10000,
      scenarioVersion: "v1", deadlineAt: 11000, next: "end",
      voteTreatment: { type: "curtain-light", answerColors: {}, entry: null,
        curtain: { src: "curtain.png", baked: 0, folds: 1, shine: 1, shadow: 1, poolBase: 1, poolGain: 1, cursorFlood: 1, cursorFloodCounted: 1, neutralGap: 0 } } } });
  const dot = () => host.querySelector<HTMLSpanElement>(".live-cursor-dot");
  const surface = Math.min(window.innerWidth, window.innerHeight);
  const at = (x: number, y: number) => `translate3d(${x * surface}px, ${y * surface}px, 0) translate3d(-50%, -50%, 0)`;

  await receive(curtainVote(3));
  // Not on screen until the first touch has entered the cursor.
  expect(dot()).toBeNull();
  await receive({ t: "own_cursor", v: 2, sessionId: "show", phaseEpoch: 2, x: 0.1, y: 0.1 });
  expect(dot()).toBeNull();
  await receive({ t: "own_cursor", v: 2, sessionId: "show", phaseEpoch: 3, x: 0.5, y: 0.4 });
  expect(dot()!.style.backgroundColor).toBe("rgb(255, 89, 94)");
  expect(dot()!.style.transform).toBe(at(0.5, 0.4));
  // Finger samples steer, they do not move the dot; the server's answer does.
  const pad = host.querySelector(".trackpad")!;
  vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
  await drag(); paint();
  expect(dot()!.style.transform).toBe(at(0.5, 0.4));
  await receive({ t: "own_cursor", v: 2, sessionId: "show", phaseEpoch: 3, x: 0.2, y: 0.4 }); paint();
  expect(dot()!.style.transform).toBe(at(0.2, 0.4));
  // The next vote starts hidden again unless the server reports a kept cursor.
  await receive(curtainVote(4));
  expect(dot()).toBeNull();
});

it("answers tasks, handles full outcomes, and disables responses on disconnect and expiry", async () => {
  await receive({ t: "identity", v: 2, clientId: "visitor", color: "#ffffff", sessionId: "show", participantLease: "lease", leaseExpiresAt: 1e12 });
  const task: Extract<ServerToClientMessage, { t: "participant_task" }> = {
    t: "participant_task", v: 2, sessionId: "show", task: {
      id: "task-1", deadlineAt: Date.now() + 60000, status: "open",
      template: { id: "volunteer", title: "Volunteer", question: "Open the curtain?", notificationBody: "Choose", groupIds: ["ki"], durationMs: 60000,
        options: [{ id: "yes", label: "JA", capacity: 2, message: "Accepted" }, { id: "no", label: "NEIN", message: "Stay" }], fullMessage: "Others were faster" },
      recipient: { participantId: "visitor", optionId: null, sequence: null, status: "pending", message: "", respondedAt: null },
    },
  };
  await receive(task);
  const yes = () => host.querySelector<HTMLButtonElement>('.participant-task button')!;
  await act(async () => yes().click());
  expect(mock.send).toHaveBeenCalledWith({ t: "participant_task_response", v: 2, sessionId: "show", instanceId: "task-1", optionId: "yes" });
  await receive({ ...task, task: { ...task.task!, recipient: { ...task.task!.recipient, status: "full", message: "Others were faster" } } });
  expect(host.textContent).toContain("Others were faster"); expect(yes().disabled).toBe(false);
  await act(async () => mock.options!.onSocketLost!()); expect(yes().disabled).toBe(true);
  await receive({ t: "identity", v: 2, clientId: "visitor", color: "#ffffff", sessionId: "show", participantLease: "lease", leaseExpiresAt: 1e12 });
  await receive({ ...task, task: { ...task.task!, deadlineAt: Date.now() - 1 } }); expect(yes().disabled).toBe(true);
  await receive({ ...task, task: { ...task.task!, status: "cancelled" } }); expect(host.querySelector('.participant-task')).toBeNull();
  await receive({ ...task, sessionId: "old-show" }); expect(host.querySelector('.participant-task')).toBeNull();
});

it("holds vote buttons while reconnecting instead of dropping the tap", async () => {
  await receive({ t: "identity", v: 2, clientId: "visitor", color: "#ffffff", sessionId: "show", participantLease: "lease", leaseExpiresAt: 1e12 });
  await receive({ t: "phase", v: 2, sessionId: "show", phaseEpoch: 1, serverTime: 1000,
    phase: { id: "intro", kind: "video", src: "video.mp4", startedAt: 1000, expectedDurationMs: 10000, scenarioVersion: "v1", deadlineAt: 11000, next: "end" } });
  await receive({ t: "voting_options", v: 2, sessionId: "show", phaseEpoch: 1, method: "phone-buttons", closed: false, question: "Open the curtain?",
    options: [{ id: "A", label: "JA" }, { id: "B", label: "NEIN" }] });
  const yes = () => host.querySelector<HTMLButtonElement>('section[aria-label="Antwort wählen"] button')!;
  expect(yes().disabled).toBe(false);

  await act(async () => mock.options!.onSocketLost!());
  expect(yes().disabled).toBe(true);
  expect(host.textContent).toContain("Reconnecting…");
  mock.send.mockClear();
  await act(async () => yes().click());
  expect(mock.send).not.toHaveBeenCalled();

  await receive({ t: "identity", v: 2, clientId: "visitor", color: "#ffffff", sessionId: "show", participantLease: "lease", leaseExpiresAt: 1e12 });
  expect(yes().disabled).toBe(false);
  await act(async () => yes().click());
  expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ t: "button_vote", sessionId: "show", outcome: "A" }));
});
