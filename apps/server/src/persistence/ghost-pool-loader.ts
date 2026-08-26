import type { GhostPool, GhostSample, GhostTrack } from "../ghosts/index.js";
import type { PocketBaseClient } from "./pocketbase-client.js";

const DEFAULT_MAX_RECORDINGS = 200;

type MovementRecordingRecord = { id: string; recordingId: string; scenarioVersion: string };
type MovementRecordingBatchRecord = { recordingId: string; batchIndex: number; samples: GhostSample[] };

/**
 * Loads the pool of past completed recordings for `showId` that
 * GhostCursorPlayer replays as ghosts (see the movement_recordings
 * migration's own "for later 'ghost player' replay" comment -- this is
 * that read path). Never rejects: any PocketBase failure resolves to an
 * empty pool (zero ghosts), matching the fail-open style of
 * syncMediaFromPocketbase.
 */
export async function loadGhostPool(
  client: PocketBaseClient,
  showId: string,
  scenarioVersion: string,
  options?: { maxRecordings?: number },
): Promise<GhostPool> {
  try {
    await client.ensureAuth();
    const filter = client.pb.filter('showId = {:showId} && status = "completed"', { showId });
    // requestKey: null on every call below -- the SDK auto-cancels an
    // in-flight request when it sees another one to the same collection
    // start before the first resolves, which is exactly what firing many
    // concurrent movement_recording_batches lookups via Promise.all does
    // by default (confirmed live: without this, some of the concurrent
    // fetches below abort with "autocancelled").
    const { items: recordings } = await client.pb.collection<MovementRecordingRecord>("movement_recordings")
      .getList(1, options?.maxRecordings ?? DEFAULT_MAX_RECORDINGS, { filter, sort: "-startedAt", requestKey: null });
    if (recordings.length === 0) return { tracks: [] };

    // Prefer recordings from the currently active scenario version -- phase
    // timing (durations) may have drifted for older versions of this show,
    // which would desync ghosts' session-relative replay timing (see
    // ghosts/ghost-cursor-player.ts). Fall back to any completed recording
    // for the show if none match the current version, rather than showing
    // zero ghosts just because the show was recently republished.
    const matchingVersion = recordings.filter((record) => record.scenarioVersion === scenarioVersion);
    const candidates = matchingVersion.length > 0 ? matchingVersion : recordings;

    const tracks = await Promise.all(candidates.map(async (recording): Promise<GhostTrack> => {
      const batches = await client.pb.collection<MovementRecordingBatchRecord>("movement_recording_batches")
        .getFullList({
          filter: client.pb.filter("recordingId = {:id}", { id: recording.recordingId }),
          sort: "batchIndex",
          requestKey: null,
        });
      const samples = batches.flatMap((batch) => batch.samples).sort((a, b) => a.t - b.t);
      return { recordingId: recording.recordingId, samples };
    }));
    return { tracks: tracks.filter((track) => track.samples.length > 0) };
  } catch (error) {
    console.error("pocketbase: failed to load ghost pool", error);
    return { tracks: [] };
  }
}
