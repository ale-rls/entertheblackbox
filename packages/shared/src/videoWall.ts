/**
 * Tablet video wall: layout, slice calculator and playback timing.
 *
 * Tablets are arranged in a grid of identical screens. Each wall position
 * ("slot", A1 = top-left) plays its own pre-cut slice of the video. The
 * calculator maps the physical wall (screens plus the gaps between them, in
 * millimetres) onto the source frame, so straight lines stay straight across
 * the bezels: the source pixels that fall behind a gap are never shown.
 */

export type WallFit = "fill" | "fit";

export type WallLayout = {
  cols: number;
  rows: number;
  /** One tablet's visible screen area as mounted (landscape or portrait), and its pixel resolution. */
  screen: { widthMm: number; heightMm: number; widthPx: number; heightPx: number };
  /** Distance between the visible screen areas of neighbouring tablets (bezels + spacing). */
  gapMm: { x: number; y: number };
  /** Source (master) video the slices are cut from. */
  source: { widthPx: number; heightPx: number; fps: number };
  /** fill: the wall is covered, source edges are cropped. fit: the whole source is visible, the rest is black. */
  fit: WallFit;
  /** Wall position → tablet label (e.g. "B3" → "T07"). */
  slots: Record<string, string>;
};

export const WALL_MAX_COLS = 20;
export const WALL_MAX_ROWS = 20;

/** 10.9" iPad (2360×1640) in landscape, ~25 mm between screens, 4K master. */
export const DEFAULT_WALL_LAYOUT: WallLayout = {
  cols: 4,
  rows: 3,
  screen: { widthMm: 226.5, heightMm: 157.4, widthPx: 2360, heightPx: 1640 },
  gapMm: { x: 25, y: 25 },
  source: { widthPx: 3840, heightPx: 2160, fps: 25 },
  fit: "fill",
  slots: {},
};

/** A1 is top-left; rows are letters, columns are numbers. */
export const wallSlotId = (row: number, col: number) => `${String.fromCharCode(65 + row)}${col + 1}`;

export function wallSlotIds(layout: Pick<WallLayout, "cols" | "rows">): string[] {
  const ids: string[] = [];
  for (let row = 0; row < layout.rows; row += 1) for (let col = 0; col < layout.cols; col += 1) ids.push(wallSlotId(row, col));
  return ids;
}

/** The wall position a tablet label is assigned to, if any (case and whitespace insensitive). */
export function wallSlotForLabel(layout: Pick<WallLayout, "slots" | "cols" | "rows">, label: string): string | null {
  const wanted = label.trim().toLowerCase();
  if (!wanted) return null;
  const valid = new Set(wallSlotIds(layout));
  for (const [slot, assigned] of Object.entries(layout.slots)) {
    if (valid.has(slot) && assigned.trim().toLowerCase() === wanted) return slot;
  }
  return null;
}

/** Labels assigned to more than one wall position. */
export function duplicateWallLabels(layout: Pick<WallLayout, "slots" | "cols" | "rows">): string[] {
  const valid = new Set(wallSlotIds(layout));
  const seen = new Map<string, number>();
  for (const [slot, label] of Object.entries(layout.slots)) {
    const key = label.trim().toLowerCase();
    if (valid.has(slot) && key) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
}

/** Clip names that are safe in file names and URLs. */
export const WALL_CLIP_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const SLICE_FILE = /^([A-Za-z0-9][A-Za-z0-9-]{0,63})__([A-Z][0-9]{1,2})\.mp4$/;

export const wallSliceFileName = (clip: string, slot: string) => `${clip}__${slot}.mp4`;

export function parseWallSliceFileName(src: string): { clip: string; slot: string } | null {
  const match = SLICE_FILE.exec(src);
  return match ? { clip: match[1]!, slot: match[2]! } : null;
}

export type WallRect = { x: number; y: number; w: number; h: number };
export type WallSlice = {
  id: string;
  row: number;
  col: number;
  /** Region of the source frame this tablet shows, in source pixels. May extend past the frame in "fit" mode (black). */
  crop: WallRect;
  /** Recommended export size: the crop size (never upscaled past the tablet), rounded to even numbers for H.264. */
  export: { widthPx: number; heightPx: number };
  /** Premiere Pro: a sequence of the export size, the master clip at this Scale and Position. */
  premiere: { scalePercent: number; positionX: number; positionY: number };
};
export type WallSlicePlan = {
  wallMm: { width: number; height: number };
  /** The whole wall (screens and gaps) mapped onto the source frame, in source pixels. */
  wallPx: WallRect;
  pxPerMm: number;
  slices: WallSlice[];
  /** Areas behind the gaps between screens, in source pixels (never shown). */
  gaps: WallRect[];
};

const round = (value: number, places = 0) => { const f = 10 ** places; return Math.round(value * f) / f; };
const even = (value: number) => Math.max(2, 2 * Math.round(value / 2));

export function wallSlicePlan(layout: WallLayout): WallSlicePlan {
  const { cols, rows, screen, gapMm, source } = layout;
  const width = cols * screen.widthMm + (cols - 1) * gapMm.x;
  const height = rows * screen.heightMm + (rows - 1) * gapMm.y;
  const scaleX = source.widthPx / width, scaleY = source.heightPx / height;
  // fill: the wall fits inside the frame (frame edges cropped). fit: the frame fits inside the wall (black around it).
  const pxPerMm = layout.fit === "fill" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const wallW = width * pxPerMm, wallH = height * pxPerMm;
  const originX = (source.widthPx - wallW) / 2, originY = (source.heightPx - wallH) / 2;
  const cropW = screen.widthMm * pxPerMm, cropH = screen.heightMm * pxPerMm;

  const slices: WallSlice[] = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
    const x = originX + col * (screen.widthMm + gapMm.x) * pxPerMm;
    const y = originY + row * (screen.heightMm + gapMm.y) * pxPerMm;
    const crop = { x: Math.round(x), y: Math.round(y), w: Math.round(cropW), h: Math.round(cropH) };
    const exportW = even(Math.min(crop.w, screen.widthPx));
    const exportH = even(exportW * crop.h / crop.w);
    const scale = exportW / crop.w;
    slices.push({
      id: wallSlotId(row, col), row, col, crop,
      export: { widthPx: exportW, heightPx: exportH },
      premiere: {
        scalePercent: round(scale * 100, 2),
        // Premiere positions the clip's centre (its default anchor) in sequence pixels.
        positionX: round((source.widthPx / 2 - crop.x) * scale, 1),
        positionY: round((source.heightPx / 2 - crop.y) * scale, 1),
      },
    });
  }
  const gaps: WallRect[] = [];
  for (let col = 1; col < cols; col += 1) gaps.push({ x: originX + (col * screen.widthMm + (col - 1) * gapMm.x) * pxPerMm, y: originY, w: gapMm.x * pxPerMm, h: wallH });
  for (let row = 1; row < rows; row += 1) gaps.push({ x: originX, y: originY + (row * screen.heightMm + (row - 1) * gapMm.y) * pxPerMm, w: wallW, h: gapMm.y * pxPerMm });
  return { wallMm: { width: round(width, 1), height: round(height, 1) }, wallPx: { x: originX, y: originY, w: wallW, h: wallH }, pxPerMm, slices, gaps };
}

/**
 * Where one wall position sits in the master frame, as fractions of the
 * frame (0–1; beyond that range in "fit" mode, which shows as black). Used by
 * tablets playing an uncut video: they enlarge the whole video and shift it
 * so only their own region is on screen. Unrounded, so it is exact for small
 * videos too.
 */
export function wallCropFraction(layout: Pick<WallLayout, "cols" | "rows" | "screen" | "gapMm" | "fit">, sourceWidthPx: number, sourceHeightPx: number, slot: string): WallRect | null {
  const match = /^([A-Z])([0-9]{1,2})$/.exec(slot);
  if (!match || !(sourceWidthPx > 0) || !(sourceHeightPx > 0)) return null;
  const row = match[1]!.charCodeAt(0) - 65, col = Number(match[2]) - 1;
  const { cols, rows, screen, gapMm } = layout;
  if (row >= rows || col < 0 || col >= cols) return null;
  const width = cols * screen.widthMm + (cols - 1) * gapMm.x;
  const height = rows * screen.heightMm + (rows - 1) * gapMm.y;
  const scaleX = sourceWidthPx / width, scaleY = sourceHeightPx / height;
  const pxPerMm = layout.fit === "fill" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const originX = (sourceWidthPx - width * pxPerMm) / 2, originY = (sourceHeightPx - height * pxPerMm) / 2;
  return {
    x: (originX + col * (screen.widthMm + gapMm.x) * pxPerMm) / sourceWidthPx,
    y: (originY + row * (screen.heightMm + gapMm.y) * pxPerMm) / sourceHeightPx,
    w: screen.widthMm * pxPerMm / sourceWidthPx,
    h: screen.heightMm * pxPerMm / sourceHeightPx,
  };
}

/**
 * Size and offset of the enlarged video view inside a tablet screen of
 * `screenW`×`screenH` points, so that `crop` (fractions of the frame) fills
 * the screen exactly.
 */
export function wallVideoFrame(crop: WallRect, screenW: number, screenH: number): { left: number; top: number; width: number; height: number } {
  const width = screenW / crop.w, height = screenH / crop.h;
  // `0 - x` rather than `-x`, so position 0 is 0, not -0.
  return { left: 0 - crop.x * width, top: 0 - crop.y * height, width, height };
}

/** An ffmpeg command for one slice; pads with black first when the slice reaches past the source ("fit"). */
export function wallFfmpegCommand(layout: WallLayout, slice: WallSlice, input: string, clip: string): string {
  const { source } = layout;
  const padLeft = Math.max(0, -slice.crop.x), padTop = Math.max(0, -slice.crop.y);
  const padW = Math.max(source.widthPx + padLeft, slice.crop.x + padLeft + slice.crop.w);
  const padH = Math.max(source.heightPx + padTop, slice.crop.y + padTop + slice.crop.h);
  const needsPad = padLeft > 0 || padTop > 0 || padW > source.widthPx || padH > source.heightPx;
  const filters = [
    ...(needsPad ? [`pad=${padW}:${padH}:${padLeft}:${padTop}:black`] : []),
    `crop=${slice.crop.w}:${slice.crop.h}:${slice.crop.x + padLeft}:${slice.crop.y + padTop}`,
    `scale=${slice.export.widthPx}:${slice.export.heightPx}`,
  ];
  const fps = source.fps;
  return `ffmpeg -i "${input}" -vf "${filters.join(",")}" -r ${fps} -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -g ${fps} -keyint_min ${fps} -sc_threshold 0 -movflags +faststart ${wallSliceFileName(clip, slice.id)}`;
}

// ---------------------------------------------------------------- playback timing

export type WallPlayback = { state: "waiting" | "playing" | "ended"; seconds: number };

/** Where every tablet should be in the clip right now, from the shared server clock. */
export function wallPlaybackPosition(startAt: number | null, serverNow: number, durationSec: number, loop: boolean): WallPlayback {
  if (startAt === null || serverNow < startAt) return { state: "waiting", seconds: 0 };
  const elapsed = (serverNow - startAt) / 1000;
  if (!(durationSec > 0)) return { state: "playing", seconds: elapsed };
  if (loop) return { state: "playing", seconds: elapsed % durationSec };
  return elapsed >= durationSec ? { state: "ended", seconds: durationSec } : { state: "playing", seconds: elapsed };
}

/** Seek when further off than this; smaller drift is pulled in by nudging the playback rate. */
export const WALL_SEEK_THRESHOLD_SEC = 0.3;
export const WALL_DRIFT_TOLERANCE_SEC = 0.02;
export const WALL_MAX_RATE_NUDGE = 0.05;

/**
 * Correction for one tablet. `drift` is actual − expected position, in
 * seconds (positive = ahead). Loop wrap-around is taken into account.
 */
export function wallCorrection(actualSec: number, expectedSec: number, durationSec: number, loop: boolean): { drift: number; seek: boolean; rate: number } {
  let drift = actualSec - expectedSec;
  if (loop && durationSec > 0) {
    // 0.1 s after the loop point is close to 9.9 s, not 9.8 s behind it.
    if (drift > durationSec / 2) drift -= durationSec;
    if (drift < -durationSec / 2) drift += durationSec;
  }
  if (Math.abs(drift) > WALL_SEEK_THRESHOLD_SEC) return { drift, seek: true, rate: 1 };
  if (Math.abs(drift) <= WALL_DRIFT_TOLERANCE_SEC) return { drift, seek: false, rate: 1 };
  const nudge = Math.min(WALL_MAX_RATE_NUDGE, Math.max(-WALL_MAX_RATE_NUDGE, drift * 0.5));
  return { drift, seek: false, rate: Math.round((1 - nudge) * 1000) / 1000 };
}
