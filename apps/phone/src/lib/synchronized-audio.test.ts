import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerClock } from "@entertheblackbox/shared";
import { SynchronizedAudio } from "./synchronized-audio";

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const clock = new ServerClock();
  clock.addSample(10_000, 10_000, 11_000);
  const nodes: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; playbackRate: { value: number }; buffer: unknown; onended: (() => void) | null }> = [];
  const context = {
    state: "running", currentTime: 0, baseLatency: 0.01, outputLatency: 0.09, destination: {},
    resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 20 })),
    createBufferSource: () => {
      const node = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), playbackRate: { value: 1 }, buffer: null, onended: null };
      nodes.push(node); return node;
    },
  };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn();
  const audio = new SynchronizedAudio(clock, changed, () => context as unknown as AudioContext);
  return { audio, clock, context, nodes, changed, fetcher };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const cue = { key: "session:1", src: "scene.mp3", startedAt: 11_500, endsAt: 31_500 };

describe("scheduled phone audio", () => {
  it("preloads once and schedules against corrected time including output latency", async () => {
    const { audio, nodes, fetcher } = setup();
    await audio.preload(cue.src);
    audio.setCue(cue);
    await audio.enable();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.start.mock.calls[0]![0]).toBeCloseTo(0.4);
    expect(nodes[0]!.start.mock.calls[0]![1]).toBe(0);
    audio.dispose();
  });
  it("joins late at the current soundtrack position, not the beginning", async () => {
    const { audio, nodes } = setup();
    audio.setCue({ ...cue, startedAt: 9000 });
    await audio.enable();
    expect(nodes[0]!.start.mock.calls[0]![1]).toBeCloseTo(2.1);
    audio.dispose();
  });
  it("does not replay on an identical reconnect snapshot and cancels on scene exit", async () => {
    const { audio, nodes } = setup();
    audio.setCue(cue); await audio.enable();
    audio.setCue({ ...cue });
    expect(nodes).toHaveLength(1);
    audio.setCue(null);
    expect(nodes[0]!.stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(nodes).toHaveLength(1);
    audio.dispose();
  });
  it("does not play a previous scene after its download resolves", async () => {
    const { audio, nodes } = setup();
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    audio.setCue(cue);
    const enabled = audio.enable();
    audio.setCue(null);
    resolve(new Response(new Uint8Array([1])));
    await enabled;
    expect(nodes).toHaveLength(0);
    audio.dispose();
  });
  it("waits for clock synchronization and never starts a scene that has ended", async () => {
    const { context, nodes } = setup();
    const clock = new ServerClock();
    const audio = new SynchronizedAudio(clock, vi.fn(), () => context as unknown as AudioContext);
    audio.setCue(cue); await audio.enable();
    expect(nodes).toHaveLength(0);
    clock.addSample(10_000, 10_000, 40_000);
    await vi.advanceTimersByTimeAsync(100);
    expect(nodes).toHaveLength(0);
    audio.dispose();
  });
});

it("reports latency-compensated position and stops claiming a measurement while suspended", async () => {
  const { audio, context } = setup();
  audio.setCue({ ...cue, startedAt: 9000 }); await audio.enable();
  const report = audio.getTiming();
  expect(report.cueKey).toBe(cue.key);
  expect(report.media[0]?.positionMs).toBeCloseTo(2100);
  expect(report.media[0]?.targetMs).toBeCloseTo(2100);
  expect(report.media[0]?.driftMs).toBeCloseTo(0);
  context.state = "suspended";
  expect(audio.getTiming().media[0]).toMatchObject({ state: "disabled", positionMs: null, driftMs: null });
  audio.setCue(null); expect(audio.getTiming().media).toEqual([]);
  audio.dispose();
});
