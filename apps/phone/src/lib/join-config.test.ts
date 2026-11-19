import { expect, it, vi } from "vitest";
import { loadJoinConfig, type JoinConfig } from "./join-config";

const config: JoinConfig = { installationId: "i", roomId: "r" };

it("keeps retrying a failed join-config load until it succeeds", async () => {
  const load = vi.fn<() => Promise<JoinConfig>>()
    .mockRejectedValueOnce(new Error("Join service unavailable (502)"))
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(config);
  const errors: string[] = [];
  const waits: number[] = [];
  const result = await loadJoinConfig({
    load, cancelled: () => false, onError: (m) => errors.push(m),
    wait: async (ms) => { waits.push(ms); },
  });
  expect(result).toEqual(config);
  expect(load).toHaveBeenCalledTimes(3);
  expect(errors).toEqual(["Join service unavailable (502) — retrying…", "Failed to fetch — retrying…"]);
  expect(waits).toEqual([1_000, 2_000]);
});

it("caps the retry delay and stops once cancelled", async () => {
  let cancelled = false;
  const waits: number[] = [];
  const result = await loadJoinConfig({
    load: () => Promise.reject(new Error("offline")),
    cancelled: () => cancelled,
    onError: () => {},
    wait: async (ms) => { waits.push(ms); if (waits.length === 6) cancelled = true; },
  });
  expect(result).toBeNull();
  expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
});
