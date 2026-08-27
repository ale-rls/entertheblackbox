import PocketBase, { ClientResponseError } from "pocketbase";
import { inspectLocalMedia, studioMediaKindForSource } from "./library.js";
import type { MediaManifest } from "./local.js";

type MediaRecord = { id: string; src: string; bytes: number; hash: string; durationMs?: number };

function extensionAllowed(name: string): boolean {
  return studioMediaKindForSource(name) !== "unknown";
}

/**
 * Studio's shared media library, stored in PocketBase instead of a local
 * filesystem -- so Add Media works the same way whether Studio is running
 * via `vite dev` or served from a deployed apps/server, and uploads survive
 * a redeploy. apps/server mirrors this collection down into its own local
 * content/media/ at boot (persistence/media-sync.ts), so its existing
 * disk-backed validate/serve pipeline needs no PocketBase awareness at all
 * -- dropping a file into content/media/ by hand still works exactly as
 * before if this sync is ever turned off.
 */
export class PocketbaseMediaLibrary {
  private readonly pb: PocketBase;

  constructor(url: string) {
    this.pb = new PocketBase(url);
  }

  async list(): Promise<MediaManifest | undefined> {
    try {
      const records = await this.pb.collection<MediaRecord>("media").getFullList({ sort: "src" });
      return {
        files: records.map(({ src, bytes, hash, durationMs }) => (
          durationMs === undefined ? { src, bytes, hash } : { src, bytes, hash, durationMs }
        )),
      };
    } catch {
      // PocketBase unreachable -- manual runtime/backup imports still work.
      return undefined;
    }
  }

  async upload(file: File): Promise<void> {
    if (!extensionAllowed(file.name)) {
      throw new Error("Choose an MP4/WebM video, JPG/PNG/WebP image, or MP3 audio file.");
    }
    const inspected = await inspectLocalMedia(file);
    const data = { src: inspected.src, bytes: inspected.bytes, hash: inspected.hash, ...("durationMs" in inspected ? { durationMs: inspected.durationMs } : {}), file };
    try {
      const existing = await this.pb.collection<MediaRecord>("media")
        .getFirstListItem(this.pb.filter("src = {:src}", { src: file.name }))
        .catch(() => null);
      if (existing) await this.pb.collection("media").update(existing.id, data);
      else await this.pb.collection("media").create(data);
    } catch (error) {
      const reason = error instanceof ClientResponseError
        ? error.message
        : error instanceof Error ? error.message : "The media file could not be added.";
      throw new Error(`Could not add ${file.name}. ${reason}`);
    }
  }

  async remove(src: string): Promise<void> {
    try {
      const existing = await this.pb.collection<MediaRecord>("media")
        .getFirstListItem(this.pb.filter("src = {:src}", { src }));
      await this.pb.collection("media").delete(existing.id);
    } catch (error) {
      const reason = error instanceof ClientResponseError
        ? error.message
        : error instanceof Error ? error.message : "The media file could not be removed.";
      throw new Error(`Could not remove ${src}. ${reason}`);
    }
  }
}
