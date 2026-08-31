import { GENERATED_MARKER_TRACKS } from "./markerTracks.generated.js";
import { ORIGINAL_MARKER_TRACK, type MarkerTrack } from "./markerTrack.js";

export type { MarkerTrack };

export const MARKER_TRACKS_BY_FILENAME: Readonly<Record<string, MarkerTrack>> = {
  "idle-attract.mp4": ORIGINAL_MARKER_TRACK,
  ...GENERATED_MARKER_TRACKS,
};
