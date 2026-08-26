import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { PocketBaseClient } from "./pocketbase-client.js";

type MediaRecord = { id: string; src: string; bytes: number; file: string };

/**
 * Mirrors PocketBase's `media` collection -- Studio's upload target from
 * any environment, see media/pocketbase-media.ts on the Studio side --
 * down into the local media directory apps/server already serves from and
 * validates against (readiness.ts's statSizeWithNodeFs). Only downloads
 * files that are missing or the wrong size, and never deletes local files
 * PocketBase doesn't know about, so dropping a file into that directory by
 * hand keeps working exactly as before if this sync is ever turned off.
 */
export async function syncMediaFromPocketbase(client: PocketBaseClient, mediaDir: string): Promise<void> {
  await client.ensureAuth();
  const records = await client.pb.collection<MediaRecord>("media").getFullList();
  await mkdir(mediaDir, { recursive: true });
  for (const record of records) {
    // Defense in depth: src is meant to be a bare filename (it's also what
    // scenario phases reference directly), never a path that could escape
    // mediaDir.
    if (!record.src || record.src !== basename(record.src)) continue;
    const target = join(mediaDir, record.src);
    const current = await stat(target).catch(() => null);
    if (current?.isFile() && current.size === record.bytes) continue;

    const url = client.pb.files.getURL(record, record.file);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`pocketbase: failed to download media "${record.src}" (${response.status})`);
    }
    const tmpPath = `${target}.download-${process.pid}`;
    try {
      await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(tmpPath));
      await rename(tmpPath, target);
    } catch (error) {
      await rm(tmpPath, { force: true });
      throw error;
    }
  }
}
