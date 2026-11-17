import { describe, expect, it } from "vitest";
import { scenarioSchema, validateScenario } from "./index.js";

const base = (groupId: string) => scenarioSchema.parse({
  version: "group-empty", entryPhaseId: "check",
  groups: [{ id: "stage", label: "Stage" }, { id: "swap", label: "Wants a replacement" }],
  phases: [
    { kind: "idle", id: "idle" },
    { kind: "narration", id: "check", text: "Check", durationMs: 1000, next: "swap-scene", nextIfGroupEmpty: { groupId, target: "nobody" } },
    { kind: "narration", id: "swap-scene", text: "Swap", durationMs: 1000, next: "idle" },
    { kind: "narration", id: "nobody", text: "Nobody", durationMs: 1000, next: "idle" },
  ],
});

describe("nextIfGroupEmpty validation", () => {
  it("counts the alternative exit as reachable", () => {
    const result = validateScenario(base("swap"));
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((w) => w.code === "unreachable-phase")).toEqual([]);
  });

  it("rejects an unknown group", () => {
    expect(validateScenario(base("ghost")).errors.map((e) => e.code)).toContain("unknown-group");
  });
});
