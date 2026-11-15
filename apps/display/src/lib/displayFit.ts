/**
 * How the fixed 16:9 display frame fits a screen of another aspect ratio,
 * chosen per machine with `?fit=` on /display/ (main, group and signage).
 *
 * - `contain` (default): the whole 16:9 frame is visible, with black bars.
 * - `height`: the frame fills the screen height; the sides are cropped. For a
 *   4:3 projector this uses the full picture height.
 * - `width`: the frame fills the screen width; top and bottom are cropped.
 *
 * The frame is resized as a whole, so cursors, zones and overlays keep lining
 * up with the media. M1–M4 monitors fill their screen already and ignore it.
 */
export const DISPLAY_FITS = ["contain", "height", "width"] as const;
export type DisplayFit = (typeof DISPLAY_FITS)[number];

export function parseDisplayFit(search: string): DisplayFit {
  const requested = new URLSearchParams(search).get("fit");
  return (DISPLAY_FITS as readonly string[]).includes(requested ?? "") ? requested as DisplayFit : "contain";
}

export function applyDisplayFit(root: Pick<HTMLElement, "dataset">, search: string): DisplayFit {
  const fit = parseDisplayFit(search);
  root.dataset.fit = fit;
  return fit;
}
