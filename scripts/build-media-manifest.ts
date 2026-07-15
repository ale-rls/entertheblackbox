#!/usr/bin/env node
/**
 * CLI: build a media manifest (src/bytes/hash per file) from a local media
 * folder, in the shape validate-scenario and the server expect.
 *
 * Usage:
 *   tsx scripts/build-media-manifest.ts [<media-dir>] [--out <manifest.json>]
 *
 * Defaults (resolved relative to the current working directory):
 *   <media-dir>  content/media
 *   --out        (stdout)
 *
 * Hidden files (dotfiles such as .DS_Store) and subdirectories are skipped.
 * The manifest carries no durations by design — Show Studio computes and
 * suggests expectedDurationMs from the local file when a video is assigned.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mediaManifestSchema } from "../packages/scenario/src/index.js";

function parseArgs(argv: string[]): { mediaDir: string; outPath: string | null } {
  const positional: string[] = [];
  let outPath: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      i += 1;
      const value = argv[i];
      if (!value) throw new Error("--out requires a path argument");
      outPath = value;
    } else if (arg?.startsWith("--")) {
      throw new Error(`unknown flag "${arg}"`);
    } else if (arg) {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error("usage: build-media-manifest [<media-dir>] [--out <manifest.json>]");
  }

  return { mediaDir: positional[0] ?? "content/media", outPath };
}

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")))
      .on("error", rejectPromise);
  });
}

async function main(): Promise<number> {
  const { mediaDir, outPath } = parseArgs(process.argv.slice(2));
  const mediaDirAbs = resolve(process.cwd(), mediaDir);

  const entries = await readdir(mediaDirAbs, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  if (names.length === 0) {
    console.error(`[ERROR] no media files found in "${mediaDirAbs}"`);
    return 1;
  }

  const files = [];
  for (const name of names) {
    const path = join(mediaDirAbs, name);
    const { size } = await stat(path);
    files.push({ src: name, bytes: size, hash: await sha256OfFile(path) });
    console.error(`hashed ${name} (${size} bytes)`);
  }

  const manifest = mediaManifestSchema.parse({ files });
  const json = `${JSON.stringify(manifest, null, 2)}\n`;

  if (outPath) {
    await writeFile(resolve(process.cwd(), outPath), json, "utf-8");
    console.error(`wrote ${files.length} entries to ${outPath}`);
  } else {
    process.stdout.write(json);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[ERROR] ${(err as Error).message ?? err}`);
    process.exit(1);
  });
