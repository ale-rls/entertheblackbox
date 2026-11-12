import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { preparePublication } from "./publication.js";
import { registerMediaRoutes } from "./static.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "publication-")); roots.push(root);
  const bytes = Buffer.from("test asset");
  for (const name of ["voice.mp3", "monitor.mp4"]) await writeFile(join(root, name), bytes);
  const scenario = { version: "draft", entryPhaseId: "intro", phases: [
    { id: "intro", kind: "narration", text: "Welcome", durationMs: 5000, next: "idle", phoneAudioSrc: "voice.mp3",
      monitorCues: { M1: [{ kind: "video", src: "monitor.mp4", startMs: 0 }] } },
    { id: "idle", kind: "idle" },
  ] };
  const manifest = { files: ["voice.mp3", "monitor.mp4"].map(src => ({ src, bytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") })) };
  return { root, scenario, manifest, bytes };
}
describe("one show release", () => {
  it("freezes visual and phone assets together and pins the native version without promoting a channel", async () => {
    const { root, scenario, manifest, bytes } = await fixture();
    const result = await preparePublication(scenario, manifest, root);
    const native = JSON.parse(await readFile(join(root, "native-shows/releases", `${result.scenario.nativeReleaseId}.json`), "utf8"));
    expect(native.scenarioVersion).toBe(result.scenario.version);
    expect(result.scenario.version).not.toBe(scenario.version);
    expect(result.mediaManifest.files).toHaveLength(2);
    await writeFile(join(root, "monitor.mp4"), "replacement");
    const monitor = result.scenario.phases[0]!.monitorCues!.M1![0]!;
    expect(monitor.kind).toBe("video");
    if (monitor.kind === "video") expect(await readFile(join(root, monitor.src))).toEqual(bytes);
    await expect(readFile(join(root, "native-shows/channels/production.json"))).rejects.toThrow();
    expect(native.files[0].src).toContain("native-shows/assets/");
  });
  it("freezes a scene's loop video with the other visual assets", async () => {
    const { root, scenario, manifest, bytes } = await fixture();
    await writeFile(join(root, "loop.mp4"), bytes);
    const withLoop = { ...scenario, phases: [{ ...scenario.phases[0], loopVideoSrc: "loop.mp4" }, scenario.phases[1]] };
    const result = await preparePublication(withLoop, { files: [...manifest.files, { ...manifest.files[1]!, src: "loop.mp4" }] }, root);
    const intro = result.scenario.phases[0]!;
    expect(intro.kind === "narration" ? intro.loopVideoSrc : undefined).toMatch(/^native-shows\/assets\/[0-9a-f]{64}\.mp4$/);
  });
  it("rejects changed and missing source files before saving a release", async () => {
    const { root, scenario, manifest } = await fixture();
    await writeFile(join(root, "monitor.mp4"), "changed");
    await expect(preparePublication(scenario, manifest, root)).rejects.toThrow("Media missing or changed");
    await rm(join(root, "monitor.mp4"));
    await expect(preparePublication(scenario, manifest, root)).rejects.toThrow();
  });
  it("keeps both legacy native URLs on the active version until activation", async () => {
    const app = Fastify(); let version = "running";
    registerMediaRoutes(app, "/unused", async () => ({ scenarioVersion: version }));
    try {
      for (const channel of ["production", "rehearsal"]) {
        const response = await app.inject(`/media/native-shows/channels/${channel}.json`);
        expect(response.json().scenarioVersion).toBe("running");
        expect(response.headers["cache-control"]).toBe("no-store");
      }
      version = "next";
      expect((await app.inject("/media/native-shows/channels/production.json")).json().scenarioVersion).toBe("next");
    } finally { await app.close(); }
  });
});
