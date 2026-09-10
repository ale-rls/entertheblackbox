/**
 * The join URL is long enough that maximum (H) correction creates a very
 * dense symbol. Q is a better projection compromise: more recovery than M
 * without making the individual modules as small as H would.
 */
export const TRACKED_QR_ERROR_CORRECTION_LEVEL = "Q" as const;

/** ISO/IEC 18004's standard QR quiet zone. */
export const TRACKED_QR_MARGIN_MODULES = 4;

