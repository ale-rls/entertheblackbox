// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneAudio } from "./PhoneAudio";

let root: Root;
let host: HTMLDivElement;
let streamUrl: string;
let request: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.spyOn>;
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  streamUrl = "https://audio.test/stream/one";
  request = vi.fn(async () => ({ ok: true, json: async () => ({ streamUrl }) }));
  vi.stubGlobal("fetch", request);
  load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(lease = "lease-one", override?: string) {
  await act(async () => root.render(<PhoneAudio participantLease={lease} streamUrlOverride={override ?? null} />));
}
async function start() {
  await act(async () => host.querySelector("button")!.click());
  await act(async () => host.querySelector("audio")!.dispatchEvent(new Event("playing")));
}

describe("phone audio lifecycle", () => {
  it("keeps one playing element across lease renewals and uses the latest lease for reports", async () => {
    await render(); await start();
    const audio = host.querySelector("audio")!;
    await render("lease-two");
    expect(host.querySelector("audio")).toBe(audio);
    expect(load).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () => audio.dispatchEvent(new Event("waiting")));
    const report = request.mock.calls.filter(([url]) => url === "/api/audio/event").at(-1)!;
    expect(JSON.parse(report[1].body)).toMatchObject({ participantLease: "lease-two", state: "reconnecting" });
  });
  it("continues on a new backend without another start gesture", async () => {
    await render(); await start();
    const audio = host.querySelector("audio")!;
    await render("lease-one", "https://local.test/stream/one");
    expect(host.querySelector("audio")).toBe(audio);
    expect(audio.src).toContain("https://local.test/stream/one?");
    expect(load).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledTimes(2);
    expect(host.querySelector("button")).toBeNull();
  });
  it("ignores a late registration URL after a backend override arrives", async () => {
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    await render();
    await render("lease-one", "https://local.test/stream/one");
    await start();
    await act(async () => resolve({ ok: true, json: async () => ({ streamUrl }) }));
    expect(host.querySelector("audio")!.src).toContain("https://local.test/stream/one?");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("keeps a switched stream while identity renewal clears its override", async () => {
    await render(); await start();
    await render("lease-one", "https://local.test/stream/one");
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    await render("lease-two");
    expect(host.querySelector("audio")!.src).toContain("https://local.test/stream/one?");
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => resolve({ ok: true, json: async () => ({ streamUrl: "https://local.test/stream/one" }) }));
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("keeps playback and cleanup working when optional media session actions throw", async () => {
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: {
      setActionHandler: () => { throw new Error("unsupported"); },
      set playbackState(_state: string) { throw new Error("unsupported"); },
    } });
    try {
      await render(); await start();
      expect(host.textContent).toContain("Headphone stream connected");
      await act(async () => root.render(null));
      expect(load).toHaveBeenCalledTimes(2);
    } finally { Reflect.deleteProperty(navigator, "mediaSession"); }
  });
});

it("hides silent-stage controls without replacing the stream element", async () => {
  await render(); await start();
  const audio = host.querySelector("audio");
  await act(async () => root.render(<PhoneAudio participantLease="lease-one" active={false} />));
  expect(host.querySelector("section")!.style.display).toBe("none");
  expect(host.querySelector("audio")).toBe(audio);
  await render();
  expect(host.querySelector("section")!.style.display).toBe("");
  expect(play).toHaveBeenCalledTimes(1);
});
