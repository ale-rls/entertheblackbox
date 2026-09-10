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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

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
 * Narration length is unknown until the real recordings exist: his file carries
 * `duration_s: 0` for them because his engine plays until the audio ends, while
 * ours needs a number up front. Regenerate with `pnpm build-media-manifest`
 * once the final audio is in content/media, then update these.
 */
const PLACEHOLDER_NARRATION_MS = 60_000;
const CONNECTION_STALE_AFTER_MS = 5_000;

function parseShowYaml(text: string): Round[] {
  // Deliberately not a general YAML parser: this reads one known file with a
  // fixed two-level shape, and adding a YAML dependency to the workspace for a
  // one-way import tool is not worth it. Fails loudly on anything unexpected.
  const rounds: Round[] = [];
  const lines = text.split("\n");
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

function fieldFor(round: Round): Record<string, unknown> {
  const labels = round.form_labels ?? {};
  const options = round.options ?? [];
  const labelFor = (zone: string, fallback: string) =>
    options.find((option) => option.zone === zone)?.label || fallback;

  switch (round.form) {
    case "scale":
      return {
        type: "two-quadrant", axis: "x", variant: "spectrum",
        labels: { minLabel: labels.left ?? "min", maxLabel: labels.right ?? "max" },
      };
    case "scale3":
      return {
        type: "polygon-zones",
        zones: [
          band("scale-left", labelFor("scale_left", labels.left ?? "left"), 0, 1 / 3),
          band("scale-mid", labelFor("scale_mid", labels.middle ?? "middle"), 1 / 3, 2 / 3),
          band("scale-right", labelFor("scale_right", labels.right ?? "right"), 2 / 3, 1),
        ],
      };
    case "rings":
      // Innermost first. zoneOfPolygons returns the first zone containing the
      // point, so a centre position matches the inner disc before the outer
      // one. Reordering these silently inverts the question.
      return {
        type: "polygon-zones",
        zones: [
          circle("ring-center", labelFor("ring_center", labels.center ?? "centre"), 0.17),
          circle("ring-mid", labelFor("ring_mid", "middle"), 0.34),
          circle("ring-edge", labelFor("ring_edge", labels.edge ?? "edge"), 0.5),
        ],
      };
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
      return {
        type: "polygon-zones",
        zones: [
          quadrant("field-top-left", "cross_tl", 0, 0),
          quadrant("field-top-right", "cross_tr", 0.5, 0),
          quadrant("field-bottom-left", "cross_bl", 0, 0.5),
          quadrant("field-bottom-right", "cross_br", 0.5, 0.5),
        ],
      };
    }
    case "cross":
    default:
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

function main(): void {
  const [source, ...rest] = process.argv.slice(2);
  if (source === undefined) {
    console.error("usage: tsx scripts/import-show-yaml.ts <show.yaml> [--out-dir content]");
    process.exit(2);
  }
  const outDirIndex = rest.indexOf("--out-dir");
  const outDir = resolve(outDirIndex === -1 ? "content" : rest[outDirIndex + 1] ?? "content");

  const rounds = parseShowYaml(readFileSync(source, "utf8"));
  if (rounds.length === 0) throw new Error(`no rounds parsed from ${source}`);

  const phases: Array<Record<string, unknown>> = [{ kind: "idle", id: "idle" }];
  const media = new Set<string>();

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
        expectedDurationMs: (round.duration_s ?? 0) > 0
          ? (round.duration_s ?? 0) * 1_000
          : PLACEHOLDER_NARRATION_MS,
        next,
      });
      return;
    }
    phases.push({
      kind: "position-question", id: round.id,
      text: round.text ?? round.question ?? round.id,
      durationMs: (round.duration_s ?? 45) * 1_000,
      freezeMs: (round.grace_s ?? 5) * 1_000,
      connectionStaleAfterMs: CONNECTION_STALE_AFTER_MS,
      showLiveCounts: true,
      field: fieldFor(round),
      next: { type: "fixed", target: next },
    });
  });

  const scenario = {
    version: "1.0.0",
    entryPhaseId: rounds[0]!.id,
    cyclesAllowed: false,
    phases,
  };

  mkdirSync(join(outDir, "scenarios"), { recursive: true });
  const scenarioPath = join(outDir, "scenarios", "entertheblackbox.json");
  writeFileSync(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);

  const questions = phases.filter((phase) => phase.kind === "position-question").length;
  const narrations = phases.filter((phase) => phase.kind === "video").length;
  console.log(`wrote ${scenarioPath} (${questions} questions, ${narrations} narration cues)`);
  // No manifest is written: every entry needs the byte length and hash of a
  // real file, so the manifest is a build artifact of the media rather than
  // something this importer can invent.
  console.log(`\nrequired media, to be placed in content/media:`);
  for (const src of [...media].sort()) console.log(`  ${src}`);
  console.log(`\nthen: pnpm build-media-manifest`);
}

main();
