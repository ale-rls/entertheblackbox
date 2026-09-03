/**
 * The venue kiosk always renders 16:9. Zone/arena editors calibrate their
 * backdrop against this fixed resolution rather than the studio operator's
 * own browser window, so a shape drawn in Studio lines up with the same
 * `object-fit: cover`-cropped frame the display shows, regardless of what
 * size window it was drawn in.
 */
export const REFERENCE_DISPLAY_WIDTH = 1920;
export const REFERENCE_DISPLAY_HEIGHT = 1080;
