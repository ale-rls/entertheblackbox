import type { StudioProject } from "@smartphonecracy/studio-adapter";
import type { Draft } from "../model.js";

type RuntimeMediaManifest = StudioProject["manifest"];
type RuntimeMediaFile = RuntimeMediaManifest["files"][number];
export type MediaManifest = {
  files: Array<RuntimeMediaFile & { durationMs?: number; previewUrl?: string }>;
};

export function runtimeMediaManifest(manifest: MediaManifest): RuntimeMediaManifest {
  return {
    files: manifest.files.map(({ src, bytes, hash }) => ({ src, bytes, hash })),
  };
}

/** Merge a freshly loaded media library into a draft, preserving manually imported entries the library doesn't know about. */
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
    if (phase.kind !== "video" && phase.kind !== "video-position-question") return phase;
    const mediaDurationMs = durationBySource.get(phase.audioSrc ?? phase.src);
    if (mediaDurationMs === undefined) return phase;
    const expectedDurationMs = mediaDurationMs + (phase.tailDurationMs ?? 0);
    if (phase.kind === "video-position-question" && phase.audioSrc !== undefined) {
      const previousMediaDurationMs = phase.expectedDurationMs - (phase.tailDurationMs ?? 0);
      const shiftMs = mediaDurationMs - previousMediaDurationMs;
      return {
        ...phase,
        expectedDurationMs,
        showAtMs: phase.showAtMs + shiftMs,
        openAtMs: phase.openAtMs + shiftMs,
        closeAtMs: phase.closeAtMs + shiftMs,
        hideAtMs: phase.hideAtMs + shiftMs,
      };
    }
    return { ...phase, expectedDurationMs };
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
