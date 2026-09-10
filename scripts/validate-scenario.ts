#!/usr/bin/env node
/**
 * CLI: validate a scenario file (+ its media manifest) against the
 * @entertheblackbox/scenario Zod schemas and graph/media validators
 * (plan §5, STEP-003).
 *
 * Usage:
 *   tsx scripts/validate-scenario.ts <scenario.json> [--manifest <manifest.json>] [--media-dir <dir>]
 *
 * Defaults (resolved relative to the current working directory):
 *   --manifest   content/media-manifest.json
 *   --media-dir  content/media
 *
 * Exit code: 0 when the scenario and manifest are valid (warnings are
 * allowed), 1 if any error is found (parse error, graph error, or media
 * error).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  mediaManifestSchema,
  scenarioSchema,
  statSizeWithNodeFs,
  validateMediaManifest,
  validateScenario,
} from "../packages/scenario/src/index.js";

type Line = { severity: "error" | "warning"; message: string };

function printLines(lines: Line[]): void {
  for (const line of lines) {
    const prefix = line.severity === "error" ? "ERROR" : "WARN";
    console.log(`[${prefix}] ${line.message}`);
  }
}

function parseArgs(argv: string[]): {
  scenarioPath: string;
  manifestPath: string;
  mediaDir: string;
} {
  const positional: string[] = [];
  let manifestPath = "content/media-manifest.json";
  let mediaDir = "content/media";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      i += 1;
      const value = argv[i];
      if (!value) throw new Error("--manifest requires a path argument");
      manifestPath = value;
    } else if (arg === "--media-dir") {
      i += 1;
      const value = argv[i];
      if (!value) throw new Error("--media-dir requires a path argument");
      mediaDir = value;
    } else if (arg?.startsWith("--")) {
      throw new Error(`unknown flag "${arg}"`);
    } else if (arg) {
      positional.push(arg);
    }
  }

  const scenarioPath = positional[0];
  if (!scenarioPath) {
    throw new Error(
      "usage: validate-scenario <scenario.json> [--manifest <manifest.json>] [--media-dir <dir>]",
    );
  }

  return { scenarioPath, manifestPath, mediaDir };
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

async function main(): Promise<number> {
  const { scenarioPath, manifestPath, mediaDir } = parseArgs(process.argv.slice(2));

  const scenarioAbs = resolve(process.cwd(), scenarioPath);
  const manifestAbs = resolve(process.cwd(), manifestPath);
  const mediaDirAbs = resolve(process.cwd(), mediaDir);

  const lines: Line[] = [];
  let hasError = false;

  let scenarioRaw: unknown;
  try {
    scenarioRaw = await readJson(scenarioAbs);
  } catch (err) {
    printLines([
      { severity: "error", message: `failed to read/parse scenario "${scenarioAbs}": ${(err as Error).message}` },
    ]);
    return 1;
  }

  const scenarioResult = scenarioSchema.safeParse(scenarioRaw);
  if (!scenarioResult.success) {
    for (const issue of scenarioResult.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      lines.push({ severity: "error", message: `scenario schema: ${path}: ${issue.message}` });
    }
    hasError = true;
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = await readJson(manifestAbs);
  } catch (err) {
    printLines([
      ...lines,
      { severity: "error", message: `failed to read/parse manifest "${manifestAbs}": ${(err as Error).message}` },
    ]);
    return 1;
  }

  const manifestResult = mediaManifestSchema.safeParse(manifestRaw);
  if (!manifestResult.success) {
    for (const issue of manifestResult.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      lines.push({ severity: "error", message: `manifest schema: ${path}: ${issue.message}` });
    }
    hasError = true;
  }

  // Graph-level validation requires both to have parsed successfully.
  if (scenarioResult.success && manifestResult.success) {
    const graphResult = validateScenario(scenarioResult.data, manifestResult.data);
    for (const issue of graphResult.errors) {
      lines.push({ severity: "error", message: issue.message });
    }
    for (const issue of graphResult.warnings) {
      lines.push({ severity: "warning", message: issue.message });
    }
    if (!graphResult.ok) hasError = true;

    const mediaResult = await validateMediaManifest(
      manifestResult.data,
      statSizeWithNodeFs(mediaDirAbs),
    );
    for (const issue of mediaResult.errors) {
      lines.push({ severity: "error", message: issue.message });
    }
    if (!mediaResult.ok) hasError = true;
  }

  printLines(lines);

  if (hasError) {
    console.log("FAIL: scenario validation found errors");
    return 1;
  }

  console.log("OK: scenario valid" + (lines.length > 0 ? " (warnings only)" : ""));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[ERROR] ${(err as Error).message ?? err}`);
    process.exit(1);
  });
