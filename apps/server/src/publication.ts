import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { mediaManifestSchema, scenarioSchema, validateScenario } from "@entertheblackbox/scenario";
import { backgroundMusicSchema, type BackgroundMusic } from "@entertheblackbox/show-content";
import { prepareScenario } from "@entertheblackbox/show-content/publisher";

const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
/** Freeze every referenced asset before committing a scenario to PocketBase. */
export async function preparePublication(input: unknown, manifestInput: unknown, mediaDir: string, music?: BackgroundMusic) {
  const scenario = scenarioSchema.parse(input);
  const manifest = mediaManifestSchema.parse(manifestInput);
  const backgroundMusic = backgroundMusicSchema.optional().parse(music ?? scenario.backgroundMusic);
  const graph = validateScenario(scenario, manifest);
  if (!graph.ok) throw new Error(graph.errors.map(issue => issue.message).join("; "));
  const root = await realpath(mediaDir);
  const sources = new Set<string>();
  // Only media-bearing keys, never arbitrary strings such as narration or answer labels.
  function mapMedia(value: unknown, replace: (src: string) => string): unknown {
    if (Array.isArray(value)) return value.map(item => mapMedia(item, replace));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      ["src", "audioSrc", "extraAudioSrc", "loopVideoSrc", "phoneAudioSrc"].includes(key) && typeof item === "string"
        ? replace(item)
        : key === "phoneAudioByGroup" && item && typeof item === "object"
          ? Object.fromEntries(Object.entries(item).map(([group, src]) => [group, replace(src as string)]))
          : mapMedia(item, replace),
    ]));
  }
  const content = { ...scenario, backgroundMusic };
  mapMedia(content, src => { sources.add(src); return src; });
  const replacements = new Map<string, string>();
  const files = [];
  for (const src of sources) {
    if (isAbsolute(src)) throw new Error(`Absolute media path: ${src}`);
    const path = await realpath(resolve(root, src));
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Media escapes root: ${src}`);
    const bytes = await readFile(path);
    const digest = hash(bytes);
    const declared = manifest.files.find(file => file.src === src);
    if (!declared || declared.bytes !== bytes.length || declared.hash !== digest) throw new Error(`Media missing or changed: ${src}. Refresh the media library before publishing.`);
    const frozen = `native-shows/assets/${digest}${extname(src).toLowerCase()}`;
    const destination = resolve(root, frozen);
    await mkdir(dirname(destination), { recursive: true });
    try { await writeFile(destination, bytes, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (hash(await readFile(destination)) !== digest) throw new Error(`Stored media is corrupt: ${src}`);
    replacements.set(src, frozen);
    files.push({ src: frozen, bytes: bytes.length, hash: digest });
  }
  const frozen = scenarioSchema.parse(mapMedia(content, src => replacements.get(src)!));
  frozen.version = `release-${randomUUID()}`;
  const native = await prepareScenario(frozen, root, frozen.backgroundMusic);
  frozen.nativeReleaseId = native.revision;
  return { scenario: frozen, mediaManifest: { files: [...new Map(files.map(file => [file.src, file])).values()] } };
}
