import { describe, expect, it } from "vitest";
import { parseRuntimeScenario } from "@smartphonecracy/studio-adapter";
import scenario from "../../../../content/scenarios/dev.json";
import manifest from "../../../../content/media-manifest.json";
import { branchMediaBudgets, distinctReferencedBytes, inspectLocalMedia, phaseMediaSources } from "../media/library.js";
import { diagnostics, exportBlocked } from "./diagnostics.js";

describe("Studio media and diagnostics", () => {
  it("hashes local files and suggests their video duration", async () => {
    const file = new File(["abc"], "clip.mp4");
    await expect(inspectLocalMedia(file, async () => 1234)).resolves.toMatchObject({ src: "clip.mp4", bytes: 3, durationMs: 1234, hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  });
  it("reads MP3 duration but does not invent a duration for still images", async () => {
    const duration = async () => 8_765;
    await expect(inspectLocalMedia(new File(["audio"], "voice.mp3"), duration)).resolves.toMatchObject({ src: "voice.mp3", durationMs: 8_765 });
    await expect(inspectLocalMedia(new File(["image"], "portrait.png"), async () => { throw new Error("should not run"); })).resolves.not.toHaveProperty("durationMs");
  });
  it("counts distinct referenced hashes once and reports branch totals", () => {
    const project = parseRuntimeScenario(scenario, manifest);
    expect(distinctReferencedBytes(project)).toBe(67);
    expect(branchMediaBudgets(project, "question-quadrant")).toEqual({ q1: 0, q2: 0, q3: 0, q4: 0, tie: 0, empty: 0 });
  });
  it("counts a video's optional extra audio track as referenced media", () => {
    const project = parseRuntimeScenario(scenario, manifest);
    const phase = project.scenario.phases.find((item) => item.id === "intro-video");
    if (phase?.kind !== "video") throw new Error("missing intro video fixture");
    phase.extraAudioSrc = "soundtrack.mp3";
    project.manifest.files.push({ src: "soundtrack.mp3", bytes: 11, hash: "soundtrack" });

    expect(phaseMediaSources(phase)).toEqual(["intro.mp4", "soundtrack.mp3"]);
    expect(distinctReferencedBytes(project)).toBe(78);
  });
  it("exercises errors, warnings, information, acknowledgement, and node focus metadata", () => {
    const project = parseRuntimeScenario(scenario, manifest);
    project.manifest.files.push({ ...project.manifest.files[0]!, src: "unused-copy.mp4" });
    const items = diagnostics(project);
    expect(items.map((item) => item.code)).toEqual(expect.arrayContaining(["duplicate-media-hash", "unused-media", "media-budget", "live-counts-influence", "converging-outcomes", "abandoned-solo-empty-review"]));
    expect(items.filter((item) => item.code === "live-counts-influence").map((item) => item.phaseId)).toEqual(expect.arrayContaining(["question-fixed", "question-quadrant"]));
    expect(exportBlocked(items, new Set())).toBe(true);
  });
  it("blocks missing media and an over-budget distinct referenced file", () => {
    const project = parseRuntimeScenario(scenario, manifest);
    project.manifest.files[0]!.bytes = 2 * 1024 * 1024 * 1024 + 1;
    const items = diagnostics(project);
    expect(items.map((item) => item.code)).toContain("media-budget-exceeded");
    expect(exportBlocked(items, new Set(items.filter((item) => item.acknowledgementRequired).map((item) => `${item.code}:${item.phaseId ?? ""}:${item.message}`)))).toBe(true);
  });
});
