import { describe, expect, it } from "vitest";
import { flowNeedsReload, SAME_BOOT_TOLERANCE_MS, serverBootAt } from "./flow-refresh.js";

describe("cue sheet graph refresh", () => {
  it("dates the server boot from its own clock, falling back to the receive time", () => {
    expect(serverBootAt({ uptimeMs: 60_000, serverTime: 1_000_000 }, 999_000)).toBe(940_000);
    expect(serverBootAt({ uptimeMs: 60_000 }, 1_000_000)).toBe(940_000);
  });
  it("loads when nothing is loaded yet", () => {
    expect(flowNeedsReload(null, 940_000)).toBe(true);
  });
  it("keeps the graph across polls of the same server run, despite clock jitter", () => {
    expect(flowNeedsReload(940_000, 940_000 + SAME_BOOT_TOLERANCE_MS - 1)).toBe(false);
  });
  it("reloads after the server restarted (publishing a show restarts it)", () => {
    expect(flowNeedsReload(940_000, 2_000_000)).toBe(true);
  });
});
