#!/usr/bin/env tsx
/**
 * Convert the sibling Python runner's `content/show.yaml` into a scenario
 * graph this engine can play.
 *
 * The narration text in that file is the script already transcribed, which is
 * real work worth carrying over rather than retyping. The two formats hold the
 * same content in different shapes: his is a flat list of `rounds`, ours is a
 * validated phase graph.
 *
 * Re-runnable on purpose. While both repositories exist his file stays the
 * authoring copy for the audio, so re-importing is cheaper than hand-patching
 * this scenario every time a line changes. Once authoring moves into Show
 * Studio, delete this script rather than letting the two drift.
 *
 *   pnpm tsx scripts/import-show-yaml.ts <show.yaml> [--out-dir content]
 *
 * Form mapping:
 *   scale      -> two-quadrant, spectrum       (continuous "rosa Skala")
 *   scale3     -> polygon-zones, 3 bands       (left / middle / right)
 *   cross      -> four-quadrant                (named x and y axes)
 *   quadrants  -> four-quadrant                (four labelled fields)
 *   rings      -> polygon-zones, nested        (innermost zone listed first;
 *                                               zoneOfPolygons returns the
 *                                               first match, so order matters)
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scenarioSchema, validateScenario } from "../packages/scenario/src/index.js";

type Round = {
  id: string;
  question?: string;
  type: "narration" | "majority";
  duration_s?: number;
  grace_s?: number;
  form?: "scale" | "scale3" | "cross" | "quadrants" | "rings";
  form_labels?: Record<string, string>;
  audio?: string;
  text?: string;
  options?: Array<{ zone: string; label: string }>;
};

/** Still image behind every narration cue; the MP3 drives the timing. */
const NARRATION_IMAGE = "narration.png";
/**
 * Used only when a narration's length cannot be established. His engine plays
 * until the audio ends, so his file carries `duration_s: 0`; ours needs a
 * number up front, and the server abandons a video phase `expectedDurationMs`
 * plus five seconds after it starts. A narration longer than this value is
 * therefore cut off mid-sentence, which is why falling back to it is a
 * warning and a non-zero exit rather than a silent default.
 */
const PLACEHOLDER_NARRATION_MS = 60_000;

type ImportDiagnostics = {
  unknownDurations: string[];
  unmatchedZones: Array<{ round: string; zone: string }>;
};

/**
 * Real length of a narration MP3, in milliseconds, or null.
 *
 * The media manifest cannot answer this: it records src, bytes and hash only.
 * So the file itself is measured, which needs ffprobe. Without it, or without
 * the audio present, the caller falls back and is told loudly.
 */
function audioDurationMs(mediaDir: string, file: string): number | null {
  const path = join(mediaDir, file);
  if (!existsSync(path)) return null;
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
const CONNECTION_STALE_AFTER_MS = 5_000;

function parseShowYaml(text: string): Round[] {
  // Deliberately not a general YAML parser: this reads one known file with a
  // fixed two-level shape, and adding a YAML dependency to the workspace for a
  // one-way import tool is not worth it. Fails loudly on anything unexpected.
  const rounds: Round[] = [];
  // Git checks this authoring file out with CRLF on Windows; remove the CR so
  // the indentation-anchored grammar behaves identically on every platform.
  const lines = text.split(/\r?\n/);
  let current: Round | null = null;
  let blockKey: string | null = null;
  let blockLines: string[] = [];
  let mapKey: string | null = null;
  let listKey: string | null = null;

  const flushBlock = () => {
    if (current !== null && blockKey !== null) {
      const dedented = blockLines.map((line) => line.replace(/^ {6}/, ""));
      (current as Record<string, unknown>)[blockKey] = dedented.join("\n").trim();
    }
    blockKey = null;
    blockLines = [];
  };

  for (const raw of lines) {
    if (blockKey !== null) {
      if (raw.trim() === "" || raw.startsWith("      ")) { blockLines.push(raw); continue; }
      flushBlock();
    }
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;

    const item = /^ {2}- id: (.+)$/.exec(raw);
    if (item) {
      if (current !== null) rounds.push(current);
      current = { id: item[1]!.trim(), type: "majority" };
      mapKey = null; listKey = null;
      continue;
    }
    if (current === null) continue;

    const field = /^ {4}(\w+):\s*(.*)$/.exec(raw);
    if (field) {
      const [, key, value] = field as unknown as [string, string, string];
      mapKey = null; listKey = null;
      if (value === "|" || value === "|-") { blockKey = key; blockLines = []; continue; }
      if (value === "") {
        if (key === "options") { listKey = key; (current as Record<string, unknown>)[key] = []; }
        else { mapKey = key; (current as Record<string, unknown>)[key] = {}; }
        continue;
      }
      const unquoted = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      const numeric = /^-?\d+(\.\d+)?$/.test(unquoted);
      (current as Record<string, unknown>)[key] = numeric ? Number(unquoted) : unquoted;
      continue;
    }

    const nested = /^ {6}(\w+):\s*(.*)$/.exec(raw);
    if (nested && mapKey !== null) {
      const [, key, value] = nested as unknown as [string, string, string];
      (( current as Record<string, unknown>)[mapKey] as Record<string, string>)[key] =
        value.replace(/^"(.*)"$/, "$1");
      continue;
    }

    const listItem = /^ {6}- zone: (.+)$/.exec(raw);
    if (listItem && listKey !== null) {
      ((current as Record<string, unknown>)[listKey] as Array<Record<string, string>>).push({
        zone: listItem[1]!.trim(), label: "",
      });
      continue;
    }
    const listField = /^ {8}(\w+):\s*(.*)$/.exec(raw);
    if (listField && listKey !== null) {
      const options = (current as Record<string, unknown>)[listKey] as Array<Record<string, string>>;
      const last = options[options.length - 1];
      if (last !== undefined) last[listField[1]!] = listField[2]!.replace(/^"(.*)"$/, "$1");
      continue;
    }
  }
  flushBlock();
  if (current !== null) rounds.push(current);
  return rounds;
}

/** Vertical band covering [x0, x1) across the full height. */
const band = (id: string, label: string, x0: number, x1: number) => ({
  id, label,
  points: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 1 }, { x: x0, y: 1 }],
});

/** Circle approximated as a polygon, centred, with the given radius. */
function circle(id: string, label: string, radius: number, steps = 24) {
  const points = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return {
      x: Number((0.5 + Math.cos(angle) * radius).toFixed(4)),
      y: Number((0.5 + Math.sin(angle) * radius).toFixed(4)),
    };
  });
  return { id, label, points };
}

function fieldFor(round: Round, diagnostics: ImportDiagnostics): Record<string, unknown> {
  const labels = round.form_labels ?? {};
  const options = round.options ?? [];
  const consumed = new Set<string>();
  /**
   * Label for one of his zone names, falling back to `form_labels` and then to
   * a literal. Zone names are part of his format rather than free text, but
   * they are still his convention: anything this importer does not recognise is
   * reported at the end rather than silently replaced by a fallback, which is
   * how `ring_outer` first slipped through as `ring_edge`.
   */
  const labelFor = (zone: string, fallback: string) => {
    consumed.add(zone);
    return options.find((option) => option.zone === zone)?.label || fallback;
  };
  const reportUnmatched = () => {
    for (const option of options) {
      if (!consumed.has(option.zone)) diagnostics.unmatchedZones.push({ round: round.id, zone: option.zone });
    }
  };

  switch (round.form) {
    case "scale": {
      // A continuum, not three buckets: the script says "Ordne dich auf der
      // rosa Skala ein". His scale_left/right labels duplicate form_labels
      // exactly in every round, and scale_mid is the positional word "Mitte",
      // so nothing is lost by reading the axis labels instead. Marked consumed
      // so a genuinely new zone name still gets reported.
      for (const zone of ["scale_left", "scale_mid", "scale_right"]) consumed.add(zone);
      reportUnmatched();
      return {
        type: "two-quadrant", axis: "x", variant: "spectrum",
        labels: { minLabel: labels.left ?? "min", maxLabel: labels.right ?? "max" },
      };
    }
    case "scale3": {
      const field = {
        type: "polygon-zones",
        zones: [
          band("scale-left", labelFor("scale_left", labels.left ?? "left"), 0, 1 / 3),
          band("scale-mid", labelFor("scale_mid", labels.middle ?? "middle"), 1 / 3, 2 / 3),
          band("scale-right", labelFor("scale_right", labels.right ?? "right"), 2 / 3, 1),
        ],
      };
      reportUnmatched();
      return field;
    }
    case "rings": {
      // Innermost first. zoneOfPolygons returns the first zone containing the
      // point, so a centre position matches the inner disc before the outer
      // one. Reordering these silently inverts the question.
      const field = {
        type: "polygon-zones",
        zones: [
          circle("ring-center", labelFor("ring_center", labels.center ?? "centre"), 0.17),
          circle("ring-mid", labelFor("ring_mid", "middle"), 0.34),
          circle("ring-edge", labelFor("ring_outer", labels.edge ?? "edge"), 0.5),
        ],
      };
      reportUnmatched();
      return field;
    }
    case "quadrants": {
      // Four separately labelled fields, not two named axes. four-quadrant can
      // only carry an x and a y label pair, which would silently drop two of
      // the four, so these become explicit zones instead.
      const quadrant = (id: string, zone: string, x0: number, y0: number) => ({
        id, label: labelFor(zone, id),
        points: [
          { x: x0, y: y0 }, { x: x0 + 0.5, y: y0 },
          { x: x0 + 0.5, y: y0 + 0.5 }, { x: x0, y: y0 + 0.5 },
        ],
      });
      const field = {
        type: "polygon-zones",
        zones: [
          quadrant("field-top-left", "cross_tl", 0, 0),
          quadrant("field-top-right", "cross_tr", 0.5, 0),
          quadrant("field-bottom-left", "cross_bl", 0, 0.5),
          quadrant("field-bottom-right", "cross_br", 0.5, 0.5),
        ],
      };
      reportUnmatched();
      return field;
    }
    case "cross":
    default: {
      // Two named axes. The four cross_* labels here are readable combinations
      // of those axes ("sinnvoll für mich, wenig für andere"), unlike the
      // `quadrants` form where they are independent content, so mapping to
      // axes loses nothing.
      for (const zone of ["cross_tl", "cross_tr", "cross_bl", "cross_br"]) consumed.add(zone);
      reportUnmatched();
      return {
        type: "four-quadrant",
        xAxis: {
          minLabel: labels.x_left ?? labelFor("cross_tl", "left"),
          maxLabel: labels.x_right ?? labelFor("cross_tr", "right"),
        },
        yAxis: {
          minLabel: labels.y_top ?? labelFor("cross_bl", "top"),
          maxLabel: labels.y_bottom ?? labelFor("cross_br", "bottom"),
        },
      };
    }
  }
}

function narrationDurationMs(round: Round, mediaDir: string, diagnostics: ImportDiagnostics): number {
  if ((round.duration_s ?? 0) > 0) return (round.duration_s ?? 0) * 1_000;
  const measured = round.audio === undefined ? null : audioDurationMs(mediaDir, round.audio);
  if (measured !== null) return measured;
  diagnostics.unknownDurations.push(round.id);
  return PLACEHOLDER_NARRATION_MS;
}

function atomicReplace(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx" });
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function printValidationIssue(path: readonly (string | number)[], message: string): void {
  const location = path.length > 0 ? path.join(".") : "(root)";
  console.error(`ERROR: scenario schema: ${location}: ${message}`);
}

function main(): number {
  const [source, ...rest] = process.argv.slice(2);
  if (source === undefined) {
    console.error("usage: tsx scripts/import-show-yaml.ts <show.yaml> [--out-dir content]");
    return 2;
  }
  const outDirIndex = rest.indexOf("--out-dir");
  const outDir = resolve(outDirIndex === -1 ? "content" : rest[outDirIndex + 1] ?? "content");

  const mediaDir = resolve("content/media");
  const rounds = parseShowYaml(readFileSync(source, "utf8"));
  if (rounds.length === 0) throw new Error(`no rounds parsed from ${source}`);

  const phases: Array<Record<string, unknown>> = [{ kind: "idle", id: "idle" }];
  const media = new Set<string>();
  const diagnostics: ImportDiagnostics = { unknownDurations: [], unmatchedZones: [] };

  rounds.forEach((round, index) => {
    const next = rounds[index + 1]?.id ?? "idle";
    if (round.type === "narration") {
      if (round.audio !== undefined) media.add(round.audio);
      media.add(NARRATION_IMAGE);
      phases.push({
        kind: "video", id: round.id,
        ...(round.question === undefined ? {} : { title: round.question }),
        src: NARRATION_IMAGE,
        audioSrc: round.audio ?? "missing-audio.mp3",
        ...(round.audio ? { phoneAudioSrc: round.audio } : {}),
        expectedDurationMs: narrationDurationMs(round, mediaDir, diagnostics),
        next,
      });
      return;
    }
    if (round.audio) media.add(round.audio);
    phases.push({
      kind: "position-question", id: round.id,
      ...(round.audio ? { phoneAudioSrc: round.audio } : {}),
      // `question` is the short form for the screen; `text` is the script the
      // MP3 was voiced from, and it reads the axis labels aloud. Putting the
      // spoken version on the display would duplicate labels the overlay
      // already draws. The spoken script has no home in this schema until
      // per-phase audio exists.
      text: round.question ?? round.text ?? round.id,
      durationMs: (round.duration_s ?? 45) * 1_000,
      freezeMs: (round.grace_s ?? 5) * 1_000,
      connectionStaleAfterMs: CONNECTION_STALE_AFTER_MS,
      showLiveCounts: true,
      field: fieldFor(round, diagnostics),
      next: { type: "fixed", target: next },
    });
  });

  const candidate = {
    version: "1.0.0",
    entryPhaseId: rounds[0]!.id,
    cyclesAllowed: false,
    phases,
  };

  const scenarioPath = join(outDir, "scenarios", "entertheblackbox.json");

  const validationErrors: string[] = [];
  const scenarioResult = scenarioSchema.safeParse(candidate);
  if (!scenarioResult.success) {
    for (const issue of scenarioResult.error.issues) {
      printValidationIssue(issue.path, issue.message);
      validationErrors.push(issue.message);
    }
  } else {
    const graphResult = validateScenario(scenarioResult.data);
    for (const issue of graphResult.errors) {
      console.error(`ERROR: scenario graph: ${issue.message}`);
      validationErrors.push(issue.message);
    }
    for (const issue of graphResult.warnings) {
      console.warn(`WARN: scenario graph: ${issue.message}`);
    }
  }

  if (diagnostics.unknownDurations.length > 0) {
    console.error(
      `ERROR: ${diagnostics.unknownDurations.length} narration(s) fell back to a ` +
      `${PLACEHOLDER_NARRATION_MS / 1_000}s placeholder because their audio is not in ` +
      `${mediaDir} (or ffprobe is unavailable): ${diagnostics.unknownDurations.join(", ")}.` +
      ` Add the audio and re-run.`,
    );
    validationErrors.push("narration duration unavailable");
  }

  if (diagnostics.unmatchedZones.length > 0) {
    console.error(`ERROR: ${diagnostics.unmatchedZones.length} zone(s) not read by any form mapping:`);
    for (const { round, zone } of diagnostics.unmatchedZones) console.error(`  ${round}: ${zone}`);
    validationErrors.push("unmatched zone");
  }

  if (validationErrors.length > 0 || !scenarioResult.success) {
    console.error(`FAIL: import validation found errors; destination not changed: ${scenarioPath}`);
    return 1;
  }

  atomicReplace(scenarioPath, `${JSON.stringify(scenarioResult.data, null, 2)}\n`);
  const questions = phases.filter((phase) => phase.kind === "position-question").length;
  const narrations = phases.filter((phase) => phase.kind === "video").length;
  console.log(`wrote ${scenarioPath} (${questions} questions, ${narrations} narration cues)`);
  // No manifest is written: every entry needs the byte length and hash of a
  // real file, so the manifest is a build artifact of the media rather than
  // something this importer can invent.
  console.log(`\nrequired media, to be placed in content/media:`);
  for (const src of [...media].sort()) console.log(`  ${src}`);
  console.log(`\nthen: pnpm build-media-manifest`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`[ERROR] ${(error as Error).message ?? error}`);
  process.exitCode = 1;
}
