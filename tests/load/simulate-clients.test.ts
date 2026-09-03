import { describe, expect, it } from "vitest";
import { LoadMetrics, parseArgs } from "../../scripts/simulate-clients.js";

describe("simulate-clients", () => {
  it("defaults to a 30-client profile long enough to exercise rate-limited reconnects", () => {
    expect(parseArgs([])).toEqual({
      url: "ws://127.0.0.1:3000/ws",
      count: 30,
      durationMs: 70_000,
      installationId: "dev-installation",
      roomId: "main",
      displayToken: "dev-display-token",
      joinRateLimitMaxAttempts: 30,
      joinRateLimitWindowMs: 60_000,
    });
  });

  it("validates bounds and accepts deployment overrides", () => {
    expect(parseArgs(["--count", "12", "--duration-ms", "5000", "--url", "ws://example.test/ws"]).count).toBe(12);
    expect(() => parseArgs(["--count", "1001"])).toThrow("--count must be an integer from 1 to 1000");
    expect(() => parseArgs(["--wat"])).toThrow("--wat requires a value");
  });

  it("accepts a raised client count and matching join-rate-limit overrides for a 300-visitor run", () => {
    const options = parseArgs([
      "--count", "300",
      "--duration-ms", "180000",
      "--join-rate-limit-max-attempts", "400",
      "--join-rate-limit-window-ms", "60000",
    ]);
    expect(options.count).toBe(300);
    expect(options.joinRateLimitMaxAttempts).toBe(400);
    expect(options.joinRateLimitWindowMs).toBe(60_000);
  });

  it("reports latency percentiles, reconnects, and send drops", () => {
    const metrics = new LoadMetrics();
    metrics.inputsAttempted = 10;
    metrics.inputsSent = 8;
    metrics.reconnects = 3;
    metrics.latencies.push(2, 8, 4, 20);
    expect(metrics.summary()).toMatchObject({
      dropped: 2,
      dropPercent: 20,
      reconnects: 3,
      latencyP50Ms: 8,
      latencyP95Ms: 20,
      latencyMaxMs: 20,
    });
  });
});
