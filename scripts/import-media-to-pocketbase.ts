#!/usr/bin/env node
/**
 * CLI: backfill PocketBase's `media` collection -- Studio's shared media
 * library, see apps/studio/src/media/pocketbase-media.ts -- from files that
 * already exist on local disk but were never uploaded through Studio (for
 * example files dropped into content/media/ by hand, or restored from a
 * backup). Studio's picker (MediaLibraryDialog.tsx) only ever reads from
 * PocketBase, so those files stay invisible there forever even though
 * apps/server happily serves and validates them locally. This script closes
 * that gap by creating the missing PocketBase records (uploading the actual
 * file bytes, since the `file` field needs real content).
 *
 * Only ever creates missing records or, with --force, updates a record whose
 * hash/size disagrees with the local file -- it never deletes anything, and
 * without --force a mismatch is reported but left alone so a stale local
 * copy can't silently clobber the shared library.
 *
 * Usage:
 *   tsx scripts/import-media-to-pocketbase.ts [<media-dir>] [--dry-run] [--force]
 *
 * Env:
 *   POCKETBASE_URL (default http://127.0.0.1:8090)
 *   POCKETBASE_ADMIN_EMAIL (default dev@entertheblackbox.local)
 *   POCKETBASE_ADMIN_PASSWORD (default dev-pocketbase-password)
 *
 * Duration metadata (durationMs) is measured with ffprobe if it's on PATH,
 * the same fallback scripts/import-show-yaml.ts uses -- without it, records
 * are created with no duration, same as any file ever uploaded without one.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import PocketBase from "pocketbase";

// Kept in sync by hand with apps/studio/src/media/library.ts's
// studioMediaKindForSource and pocketbase/pb_migrations/1787741400_media_image_audio.js's
// `file` field mimeTypes. This script runs from the repo root, outside any
// app's own dependency graph, so it doesn't import across app boundaries
// for five lines of extension mapping.
const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
};

export function mimeTypeFor(name: string): string | null {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[extension] ?? null;
}

export function isMeasurable(mimeType: string): boolean {
  return mimeType.startsWith("video/") || mimeType.startsWith("audio/");
}

export type ImportArgs = { mediaDir: string; dryRun: boolean; force: boolean };

export function parseArgs(argv: string[]): ImportArgs {
  const positional: string[] = [];
  let dryRun = false;
  let force = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--")) throw new Error(`unknown flag "${arg}"`);
    else positional.push(arg);
  }
  if (positional.length > 1) {
    throw new Error("usage: import-media-to-pocketbase [<media-dir>] [--dry-run] [--force]");
  }
  return { mediaDir: positional[0] ?? "content/media", dryRun, force };
}

type MediaRecord = { id: string; src: string; bytes: number; hash: string };

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")))
      .on("error", rejectPromise);
  });
}

function durationMsOf(path: string): number | null {
  try {
    const out = execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path,
    ], { encoding: "utf8" });
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const { mediaDir, dryRun, force } = parseArgs(process.argv.slice(2));
  const mediaDirAbs = resolve(process.cwd(), mediaDir);

  const entries = await readdir(mediaDirAbs, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();

  const candidates: Array<{ name: string; mimeType: string }> = [];
  for (const name of names) {
    const mimeType = mimeTypeFor(name);
    if (mimeType) candidates.push({ name, mimeType });
    else console.error(`skip ${name}: not a recognized media type`);
  }
  if (candidates.length === 0) {
    console.error(`[ERROR] no recognized media files found in "${mediaDirAbs}"`);
    return 1;
  }

  const pb = new PocketBase(process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090");
  await pb.collection("_superusers").authWithPassword(
    process.env.POCKETBASE_ADMIN_EMAIL ?? "dev@entertheblackbox.local",
    process.env.POCKETBASE_ADMIN_PASSWORD ?? "dev-pocketbase-password",
  );
  const existing = await pb.collection<MediaRecord>("media").getFullList();
  const bySrc = new Map(existing.map((record) => [record.src, record]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let diverged = 0;
  for (const { name, mimeType } of candidates) {
    const path = join(mediaDirAbs, name);
    const { size: bytes } = await stat(path);
    const hash = await sha256OfFile(path);
    const record = bySrc.get(name);

    if (record && record.hash === hash && record.bytes === bytes) {
      skipped += 1;
      continue;
    }
    if (record && !force) {
      diverged += 1;
      console.error(`[WARN] "${name}" already exists in PocketBase with a different hash/size -- local disk and the shared library have diverged. Re-run with --force to overwrite the PocketBase copy, or check which one is actually stale first.`);
      continue;
    }

    const durationMs = isMeasurable(mimeType) ? durationMsOf(path) : null;
    if (dryRun) {
      console.error(`[dry-run] would ${record ? "update" : "create"} "${name}" (${bytes} bytes${durationMs === null ? "" : `, ${durationMs}ms`})`);
      if (record) updated += 1; else created += 1;
      continue;
    }

    const buffer = await readFile(path);
    const file = new File([buffer], name, { type: mimeType });
    const data = { src: name, bytes, hash, ...(durationMs === null ? {} : { durationMs }), file };
    if (record) {
      await pb.collection("media").update(record.id, data);
      updated += 1;
      console.error(`updated "${name}"`);
    } else {
      await pb.collection("media").create(data);
      created += 1;
      console.error(`created "${name}"`);
    }
  }

  console.error(`\n${dryRun ? "[dry-run] " : ""}${created} created, ${updated} updated, ${skipped} already in sync, ${diverged} diverged (skipped, use --force)`);
  return 0;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
