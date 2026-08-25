#!/usr/bin/env node
/**
 * CLI: publish a scenario + media manifest into PocketBase's `scenarios`
 * collection as the currently active show. The live server reads the
 * newest `status = "published"` record (see apps/server/src/readiness.ts);
 * this script is the write side Studio's "Publish" action will eventually
 * call over HTTP instead of shelling out to.
 *
 * Usage:
 *   tsx scripts/publish-scenario-to-pocketbase.ts <scenario.json> [--manifest <manifest.json>] [--show-id <id>]
 *
 * Env:
 *   POCKETBASE_URL (default http://127.0.0.1:8090)
 *   POCKETBASE_ADMIN_EMAIL (default dev@smartphonecracy.local)
 *   POCKETBASE_ADMIN_PASSWORD (default dev-pocketbase-password)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PocketBase from "pocketbase";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let manifestPath = "content/media-manifest.json";
  let showId = "default";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      manifestPath = argv[(i += 1)] ?? manifestPath;
    } else if (arg === "--show-id") {
      showId = argv[(i += 1)] ?? showId;
    } else if (arg) {
      positional.push(arg);
    }
  }

  const scenarioPath = positional[0];
  if (!scenarioPath) {
    throw new Error("usage: publish-scenario-to-pocketbase <scenario.json> [--manifest <manifest.json>] [--show-id <id>]");
  }
  return { scenarioPath, manifestPath, showId };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(): Promise<void> {
  const { scenarioPath, manifestPath, showId } = parseArgs(process.argv.slice(2));
  const scenario = await readJson(resolve(process.cwd(), scenarioPath)) as { version: string };
  const mediaManifest = await readJson(resolve(process.cwd(), manifestPath));

  const pb = new PocketBase(process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090");
  await pb.collection("_superusers").authWithPassword(
    process.env.POCKETBASE_ADMIN_EMAIL ?? "dev@smartphonecracy.local",
    process.env.POCKETBASE_ADMIN_PASSWORD ?? "dev-pocketbase-password",
  );

  const record = await pb.collection("scenarios").create({
    showId,
    version: scenario.version,
    status: "published",
    scenario,
    mediaManifest,
    publishedAt: Date.now(),
  });

  console.log(`OK: published "${showId}" version ${scenario.version} as scenarios/${record.id}`);
}

main().catch((error: unknown) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
