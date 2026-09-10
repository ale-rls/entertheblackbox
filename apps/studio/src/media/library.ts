import type { StudioProject } from "@smartphonecracy/studio-adapter";

export const MEDIA_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;
export type StudioMediaKind = "video" | "image" | "audio" | "unknown";

export function studioMediaKindForSource(src: string): StudioMediaKind {
  const extension = src.slice(src.lastIndexOf(".")).toLowerCase();
  if ([".mp4", ".webm"].includes(extension)) return "video";
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) return "image";
  if (extension === ".mp3") return "audio";
  return "unknown";
}

export function phaseMediaSources(phase: StudioProject["scenario"]["phases"][number]): string[] {
  if (phase.kind !== "video" && phase.kind !== "video-position-question") return [];
  return [
    phase.src,
    ...(phase.audioSrc === undefined ? [] : [phase.audioSrc]),
    ...(phase.extraAudioSrc === undefined ? [] : [phase.extraAudioSrc]),
  ];
}

export type MediaRow = StudioProject["manifest"]["files"][number] & {
  references: string[];
  durationMs?: number;
};

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function inspectLocalMedia(
  file: File,
  readDuration: (file: File) => Promise<number> = browserMediaDuration,
) {
  const kind = studioMediaKindForSource(file.name);
  const base = { src: file.name, bytes: file.size, hash: await sha256Hex(await file.arrayBuffer()) };
  return kind === "video" || kind === "audio"
    ? { ...base, durationMs: await readDuration(file) }
    : base;
}

async function browserMediaDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const media = document.createElement(studioMediaKindForSource(file.name) === "audio" ? "audio" : "video");
    const url = URL.createObjectURL(file);
    media.preload = "metadata";
    media.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(media.duration * 1000)); };
    media.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read duration for ${file.name}`)); };
    media.src = url;
  });
}

export function mediaRows(project: StudioProject): MediaRow[] {
  return project.manifest.files.map((file) => ({
    ...file,
    references: project.scenario.phases.filter((phase) => phaseMediaSources(phase).includes(file.src)).map((phase) => phase.id),
  }));
}

export function distinctReferencedBytes(project: StudioProject): number {
  const referenced = new Set(project.scenario.phases.flatMap(phaseMediaSources));
  const byHash = new Map<string, number>();
  for (const file of project.manifest.files) if (referenced.has(file.src)) byHash.set(file.hash, Math.max(byHash.get(file.hash) ?? 0, file.bytes));
  return [...byHash.values()].reduce((sum, bytes) => sum + bytes, 0);
}

export function branchMediaBudgets(project: StudioProject, phaseId: string): Record<string, number> {
  const byId = new Map(project.scenario.phases.map((phase) => [phase.id, phase]));
  const phase = byId.get(phaseId);
  if (!phase || (phase.kind !== "position-question" && phase.kind !== "video-position-question")) return {};
  const targets = phase.next.type === "fixed" ? { next: phase.next.target } : { ...phase.next.map, tie: phase.next.tie, empty: phase.next.empty };
  const bytesFor = (start: string) => {
    const seen = new Set<string>(); const media = new Set<string>(); const queue = [start];
    while (queue.length) {
      const id = queue.pop()!; if (seen.has(id)) continue; seen.add(id);
      const item = byId.get(id); if (!item) continue;
      if (item.kind === "video") { phaseMediaSources(item).forEach((src) => media.add(src)); queue.push(item.next); }
      else if (item.kind === "position-question" || item.kind === "video-position-question") {
        if (item.kind === "video-position-question") phaseMediaSources(item).forEach((src) => media.add(src));
        queue.push(...(item.next.type === "fixed" ? [item.next.target] : [...Object.values(item.next.map), item.next.tie, item.next.empty]));
      }
    }
    const hashes = new Map<string, number>();
    for (const file of project.manifest.files) if (media.has(file.src)) hashes.set(file.hash, Math.max(hashes.get(file.hash) ?? 0, file.bytes));
    return [...hashes.values()].reduce((sum, value) => sum + value, 0);
  };
  return Object.fromEntries(Object.entries(targets).map(([outcome, target]) => [outcome, bytesFor(target)]));
}
