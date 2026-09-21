import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { PocketBaseClient } from "./pocketbase-client.js";

/** Shared library, including clips not referenced by the active show. */
export async function listWaitingVideos(client: PocketBaseClient, mediaDir: string) {
  await client.ensureAuth();
  const records = await client.pb.collection<{ src: string; bytes: number }>("media").getFullList({ sort: "src", requestKey: null });
  return Promise.all(records.filter(({ src }) => /\.(mp4|webm)$/i.test(src) && !/[\\/]/.test(src)).map(async ({ src, bytes }) => {
    const local = await stat(join(mediaDir, src)).catch(() => null);
    return { src, url: `/media/${encodeURIComponent(src)}`, available: local?.isFile() === true && local.size === bytes };
  }));
}
