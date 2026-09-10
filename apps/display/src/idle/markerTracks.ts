import { GENERATED_MARKER_TRACKS } from "./markerTracks.generated.js";
import { ORIGINAL_MARKER_TRACK, type MarkerTrack } from "./markerTrack.js";

export type { MarkerTrack };

export const MARKER_TRACKS_BY_FILENAME: Readonly<Record<string, MarkerTrack>> =
  GENERATED_MARKER_TRACKS;

export { ORIGINAL_MARKER_TRACK };
