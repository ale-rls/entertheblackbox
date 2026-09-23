import { expect, it } from "vitest";
import { ServerClock } from "./serverClock.js";
it("bootstraps from a snapshot then uses midpoint samples without snapshot bias", () => {
  const clock = new ServerClock();
  expect(clock.ready).toBe(false);
  clock.observe(10000, 2000);
  expect(clock.now(2100)).toBe(10100);
  expect(clock.ready).toBe(true); expect(clock.hasSamples).toBe(false);
  clock.addSample(2100, 2300, 10400);
  expect(clock.offset).toBe(8200); expect(clock.roundTripMs).toBe(200);
  clock.observe(11000, 4000);
  expect(clock.offset).toBe(8200); expect(clock.sampleAgeMs(4300)).toBe(2000);
});
it("rejects impossible samples and retains the median through jitter", () => {
  const clock = new ServerClock();
  clock.addSample(100, 0, 500); clock.addSample(0, NaN, 500);
  expect(clock.ready).toBe(false);
  clock.addSample(0, 100, 1050); clock.addSample(0, 100, 1052); clock.addSample(0, 800, 900);
  expect(clock.offset).toBe(1000);
});
