export type MediaKind = "video" | "image" | "audio" | "unknown";

const MEDIA_EXTENSIONS: Record<Exclude<MediaKind, "unknown">, ReadonlySet<string>> = {
  video: new Set([".mp4", ".webm"]),
  image: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  audio: new Set([".mp3"]),
};

export function mediaKindForSource(src: string): MediaKind {
  const clean = src.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const dot = clean.lastIndexOf(".");
  const extension = dot === -1 ? "" : clean.slice(dot);
  for (const [kind, extensions] of Object.entries(MEDIA_EXTENSIONS) as Array<[Exclude<MediaKind, "unknown">, ReadonlySet<string>]>) {
    if (extensions.has(extension)) return kind;
  }
  return "unknown";
}

export function mediaCombinationError(src: string, audioSrc: string | undefined): string | undefined {
  if (audioSrc === undefined) {
    return mediaKindForSource(src) === "video"
      ? undefined
      : "src must be an MP4 or WebM video when audioSrc is omitted";
  }
  if (mediaKindForSource(src) !== "image") {
    return "src must be a JPG, PNG, or WebP image when audioSrc is present";
  }
  return mediaKindForSource(audioSrc) === "audio"
    ? undefined
    : "audioSrc must be an MP3 file";
}
