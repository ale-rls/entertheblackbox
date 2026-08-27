import { importRuntime } from "./io.js";
import type { Draft } from "./model.js";

export type PublishedProductionArtifact = {
  recordId: string;
  showId: string;
  name: string;
  version: string;
  publishedAt: number;
  scenario: unknown;
  mediaManifest: unknown;
};

/** Create a local Studio fork while retaining the immutable production base for publish-time concurrency checks. */
export function productionDraftFromArtifact(artifact: PublishedProductionArtifact): Draft {
  const draft = importRuntime(artifact.scenario, artifact.mediaManifest, `${artifact.name} — production fork`);
  return {
    ...draft,
    document: {
      ...draft.document,
      showId: artifact.showId,
      productionBaseline: {
        recordId: artifact.recordId,
        showId: artifact.showId,
        name: artifact.name,
        version: artifact.version,
        publishedAt: artifact.publishedAt,
      },
    },
  };
}

