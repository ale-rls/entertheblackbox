import type { StudioProject } from "@smartphonecracy/studio-adapter";
import type { Draft } from "../model.js";

export const LOCAL_MEDIA_MANIFEST_ENDPOINT = "/__studio/local-media-manifest";
export const LOCAL_MEDIA_FILE_ENDPOINT = "/__studio/local-media/";

type RuntimeMediaManifest = StudioProject["manifest"];
type RuntimeMediaFile = RuntimeMediaManifest["files"][number];
export type MediaManifest = {
  files: Array<RuntimeMediaFile & { durationMs?: number }>;
};

const isManifest = (value: unknown): value is MediaManifest => {
  if (!value || typeof value !== "object" || !("files" in value) || !Array.isArray(value.files)) return false;
  return value.files.every((file) => file && typeof file === "object"
    && "src" in file && typeof file.src === "string" && file.src.length > 0
    && "bytes" in file && Number.isInteger(file.bytes) && (file.bytes as number) > 0
    && "hash" in file && typeof file.hash === "string" && file.hash.length > 0
    && (!("durationMs" in file) || (Number.isInteger(file.durationMs) && (file.durationMs as number) > 0)));
};

const localMediaUrl = (source: string) => LOCAL_MEDIA_FILE_ENDPOINT
  + source.split("/").map(encodeURIComponent).join("/");

export async function uploadLocalMedia(file: File, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(localMediaUrl(file.name), {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  // A static SPA host may answer an unknown PUT with its HTML fallback and a
  // misleading 200. Only the dev-only upload middleware returns 201.
  if (response.status === 201) return;
  let message = `Could not add ${file.name}. Adding media requires the local Studio development server.`;
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch { /* Use the fallback message for non-Studio/static responses. */ }
  throw new Error(message);
}

export function browserVideoDuration(source: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve(Math.round(video.duration * 1000));
    video.onerror = () => reject(new Error(`Could not read duration for ${source}`));
    video.src = localMediaUrl(source);
  });
}

export function runtimeMediaManifest(manifest: MediaManifest): RuntimeMediaManifest {
  return {
    files: manifest.files.map(({ src, bytes, hash }) => ({ src, bytes, hash })),
  };
}

export async function loadLocalMediaManifest(
  fetcher: typeof fetch = fetch,
  readDuration: (source: string) => Promise<number> = browserVideoDuration,
): Promise<MediaManifest | undefined> {
  try {
    const response = await fetcher(LOCAL_MEDIA_MANIFEST_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    if (!isManifest(value)) return undefined;
    const files = await Promise.all(value.files.map(async (file) => {
      try {
        return { ...file, durationMs: await readDuration(file.src) };
      } catch {
        return file;
      }
    }));
    return { files };
  } catch {
    // A production/static Studio has no local filesystem endpoint; manual
    // runtime and backup imports continue to work there.
    return undefined;
  }
}

export function refreshDraftLocalMedia(draft: Draft, manifest: MediaManifest): Draft {
  const previousLocal = new Set(draft.localMediaSources ?? []);
  const currentLocal = new Set(manifest.files.map((file) => file.src));
  const importedOnly = draft.project.manifest.files.filter((file) =>
    !previousLocal.has(file.src) && !currentLocal.has(file.src));
  const files = [...importedOnly, ...runtimeMediaManifest(manifest).files]
    .sort((left, right) => left.src.localeCompare(right.src));
  const durationBySource = new Map(manifest.files.flatMap((file) =>
    file.durationMs === undefined ? [] : [[file.src, file.durationMs] as const]));
  const phases = draft.project.scenario.phases.map((phase) => {
    if (phase.kind !== "video") return phase;
    const expectedDurationMs = durationBySource.get(phase.src);
    return expectedDurationMs === undefined ? phase : { ...phase, expectedDurationMs };
  }) as Draft["project"]["scenario"]["phases"];
  return {
    ...draft,
    localMediaSources: [...currentLocal].sort(),
    project: {
      ...draft.project,
      scenario: { ...draft.project.scenario, phases },
      manifest: { files },
    },
  };
}
