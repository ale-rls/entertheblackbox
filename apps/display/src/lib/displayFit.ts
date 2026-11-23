/**
 * How the fixed 16:9 display frame fits a screen of another aspect ratio,
 * chosen per machine with `?fit=` on /display/ (main, group and signage).
 *
 * - `contain` (default): the whole 16:9 frame is visible, with black bars.
 * - `height`: the frame fills the screen height; the sides are cropped. For a
 *   4:3 projector this uses the full picture height.
 * - `width`: the frame fills the screen width; top and bottom are cropped.
 * - `intrinsic`: the frame has the pixel size of the video or still on screen,
 *   one media pixel per device pixel, centred; the window crops what does not
 *   fit. A 1920×1200 video in a 1920×1200 window fills it exactly; a smaller
 *   window shows the centre. Before any media plays the frame is 1920×1080.
 *
 * The frame is resized as a whole, so cursors, zones and overlays keep lining
 * up with the media. M1–M4 monitors fill their screen already and ignore it.
 */
export const DISPLAY_FITS = ["contain", "height", "width", "intrinsic"] as const;
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

/** Default intrinsic frame before any media has played, in media pixels. */
export const INTRINSIC_DEFAULT = { width: 1920, height: 1080 } as const;

/** CSS size of an intrinsic frame: media pixels mapped 1:1 onto device pixels. */
export function intrinsicFrameSize(width: number, height: number, devicePixelRatio: number): { width: string; height: string } {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { width: `${width / ratio}px`, height: `${height / ratio}px` };
}

/** The native size of a video or still, or null for anything else / not yet decoded. */
export function mediaPixelSize(element: EventTarget | null): { width: number; height: number } | null {
  const media = element as { tagName?: string; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number } | null;
  const size = media?.tagName === "VIDEO" ? { width: media.videoWidth ?? 0, height: media.videoHeight ?? 0 }
    : media?.tagName === "IMG" ? { width: media.naturalWidth ?? 0, height: media.naturalHeight ?? 0 } : null;
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/**
 * For `?fit=intrinsic`: sizes the frame to the media that starts playing (video) or loads (still)
 * in the display's media layer. Returns a function that stops tracking.
 */
export function trackIntrinsicSize(doc: Pick<Document, "addEventListener" | "removeEventListener">, root: { style: Pick<CSSStyleDeclaration, "setProperty"> }, devicePixelRatio: () => number): () => void {
  const apply = (width: number, height: number) => {
    const size = intrinsicFrameSize(width, height, devicePixelRatio());
    root.style.setProperty("--intrinsic-width", size.width);
    root.style.setProperty("--intrinsic-height", size.height);
  };
  apply(INTRINSIC_DEFAULT.width, INTRINSIC_DEFAULT.height);
  const listener = (event: Event) => {
    const target = event.target as (Element & EventTarget) | null;
    if (!target || typeof target.closest !== "function" || !target.closest(".layer-video")) return;
    const size = mediaPixelSize(target);
    if (size) apply(size.width, size.height);
  };
  doc.addEventListener("playing", listener, true);
  doc.addEventListener("load", listener, true);
  return () => { doc.removeEventListener("playing", listener, true); doc.removeEventListener("load", listener, true); };
}
