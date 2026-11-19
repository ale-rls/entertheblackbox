import { afterEach, describe, expect, it, vi } from "vitest";
import { guardedInterval, setTimerErrorReporter } from "./guarded-interval.js";

afterEach(() => {
  setTimerErrorReporter(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("guardedInterval", () => {
  it("keeps ticking after a failure and reports repeats at most every ten seconds", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports: string[] = [];
    setTimerErrorReporter((label, error) => reports.push(`${label}: ${(error as Error).message}`));
    let calls = 0;
    const timer = guardedInterval("show timer", () => {
      calls += 1;
      if (calls <= 50) throw new Error("bad scene");
    }, 250, () => Date.now());

    // Unguarded, the first throw here would escape the timer and end the process.
    expect(() => vi.advanceTimersByTime(15_000)).not.toThrow();
    expect(calls).toBe(60);
    expect(reports).toEqual(["show timer: bad scene", "show timer: bad scene"]);
    expect(console.error).toHaveBeenLastCalledWith("show timer failed (39 more since the last report)", expect.any(Error));
    clearInterval(timer);
  });

  it("survives a reporter that throws", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setTimerErrorReporter(() => { throw new Error("log store down"); });
    let calls = 0;
    const timer = guardedInterval("cursor frames", () => { calls += 1; throw new Error("boom"); }, 100);
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(calls).toBe(10);
    clearInterval(timer);
  });
});
