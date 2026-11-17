import { z } from "zod";

/** Colour parameters the bridge drives on an Eos channel, each 0–100 as Eos shows them. */
export const COLOR_PARAMS = ["red", "green", "blue", "amber", "mint"] as const;
export type ColorParam = (typeof COLOR_PARAMS)[number];
export type Param = "intens" | ColorParam;
/** A full or partial set of values for one Eos channel. */
export type ChannelValues = Partial<Record<Param, number>>;

const percent = z.number().min(0).max(100);
// "__proto__" cannot be stored as a plain key (it would replace the object's prototype), so it is refused.
const name = z.string().min(1).refine((value) => value !== "__proto__", "this name is reserved");
/** Parameters the looks drive. A fixture's `setup` may not set them: the player would not know the desk changed. */
const DRIVEN = new Set<string>(["intens", "intensity", ...COLOR_PARAMS]);
const setupParam = name.refine((value) => !DRIVEN.has(value.trim().toLowerCase()), "set by the looks, not by setup (setup is for e.g. \"intensity mspeed\")");
/** Largest number an OSC int32 carries; the Eos user is sent as one. */
const INT32_MAX = 2_147_483_647;

/**
 * The entry for `key` only if the file defines it. Plain `record[key]` also finds inherited
 * properties: a look named "constructor" would "exist" and resolve to a JavaScript function.
 */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "colour must be #rrggbb");

/** A palette colour: "#rrggbb", or the emitters directly (missing ones are 0). */
const colorSchema = z.union([
  hex,
  z.object({ red: percent.optional(), green: percent.optional(), blue: percent.optional(), amber: percent.optional(), mint: percent.optional() }).strict(),
]);

/** What a look does to one fixture. Leave a field out to keep the fixture's current value. */
const fixtureStateSchema = z.object({
  /** Palette name or "#rrggbb". */
  color: name.optional(),
  /** Intensity 0–100. */
  level: percent.optional(),
}).strict();

const lookSchema = z.object({
  /** Seconds to fade from the current state; 0 snaps. */
  fade: z.number().min(0).max(600).default(0),
  /** Fixture name → state. "*" applies to every fixture first; named fixtures then override it. */
  fixtures: z.record(name, fixtureStateSchema),
}).strict();

/** A look at a time within a scene: `at` is seconds from the scene's start (as monitor cues are). */
const sceneStepSchema = z.object({ at: z.number().min(0).max(24 * 3600), look: name }).strict();

export const bridgeConfigSchema = z.object({
  eos: z.object({
    host: z.string().min(1),
    /** Eos's built-in OSC over TCP (SLIP). Needs no OSC settings or firewall changes on the desk. */
    port: z.number().int().min(1).max(65535).default(3037),
    /** Eos user the bridge acts as. 0 is the background user: the operator's command line is left alone. */
    user: z.number().int().min(0).max(INT32_MAX).default(0),
  }).strict(),
  /** Fixture name → Eos channel, plus parameters set once on every (re)connect (e.g. "intensity mspeed"). */
  fixtures: z.record(name, z.object({
    channel: z.number().int().min(1).max(99_999),
    setup: z.record(setupParam, z.number()).optional(),
  }).strict()),
  palette: z.record(name, colorSchema).default({}),
  looks: z.record(name, lookSchema).default({}),
  /** Outgoing cue name (Studio → scene → External show cues) → look. */
  cues: z.record(name, name).default({}),
  /**
   * Scene ID → look, when that scene starts; or → timed steps, each a look at a time within the scene
   * (e.g. a question round in one scene whose monitors change at set times).
   */
  scenes: z.record(name, z.union([name, z.array(sceneStepSchema).min(1).max(500)])).default({}),
  /** Scene ID → vote winner ("q1"–"q4", "min"/"max" or a zone ID) → look, when that scene's vote resolves. */
  results: z.record(name, z.record(name, name)).default({}),
  /** Look when the show ends or is restarted (returns to idle). */
  showEnd: name.optional(),
}).strict();
export type BridgeConfig = z.infer<typeof bridgeConfigSchema>;
export type SceneStep = { atMs: number; look: string };

/** A scene's looks in time order: one look at its start, or its timed steps. Empty if the scene has none. */
export function sceneSteps(config: BridgeConfig, scene: string): SceneStep[] {
  const trigger = own(config.scenes, scene);
  if (trigger === undefined) return [];
  if (typeof trigger === "string") return [{ atMs: 0, look: trigger }];
  return trigger.map((step) => ({ atMs: Math.round(step.at * 1000), look: step.look })).sort((a, b) => a.atMs - b.atMs);
}
export type Look = z.infer<typeof lookSchema>;

/** Every look name a trigger points at must exist; every colour and fixture a look uses must too. */
function crossCheck(config: BridgeConfig): string[] {
  const problems: string[] = [];
  const lookExists = (look: string, where: string) => { if (!own(config.looks, look)) problems.push(`${where}: no look named "${look}"`); };
  for (const [cue, look] of Object.entries(config.cues)) lookExists(look, `cues.${cue}`);
  for (const [scene, trigger] of Object.entries(config.scenes)) {
    if (typeof trigger === "string") lookExists(trigger, `scenes.${scene}`);
    else trigger.forEach((step, index) => lookExists(step.look, `scenes.${scene}[${index}]`));
  }
  for (const [scene, winners] of Object.entries(config.results)) {
    for (const [winner, look] of Object.entries(winners)) lookExists(look, `results.${scene}.${winner}`);
  }
  if (config.showEnd) lookExists(config.showEnd, "showEnd");
  for (const [lookName, look] of Object.entries(config.looks)) {
    for (const [fixture, state] of Object.entries(look.fixtures)) {
      if (fixture !== "*" && !own(config.fixtures, fixture)) problems.push(`looks.${lookName}.fixtures.${fixture}: no fixture named "${fixture}"`);
      if (state.color && !hex.safeParse(state.color).success && !own(config.palette, state.color)) {
        problems.push(`looks.${lookName}.fixtures.${fixture}.color: "${state.color}" is not in the palette (or a #rrggbb colour)`);
      }
    }
  }
  return problems;
}

/** Parse the lighting file, with readable errors. */
export function parseBridgeConfig(raw: string): BridgeConfig {
  let json: unknown;
  try { json = JSON.parse(raw); } catch (error) {
    throw new Error(`Lighting file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = bridgeConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Lighting file is invalid:\n${parsed.error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n")}`);
  }
  const problems = crossCheck(parsed.data);
  if (problems.length) throw new Error(`Lighting file is invalid:\n${problems.map((line) => `  ${line}`).join("\n")}`);
  return parsed.data;
}

/** Emitter values for a palette name or "#rrggbb". Hex maps to red/green/blue; amber and mint stay off. */
export function resolveColor(config: BridgeConfig, color: string): Record<ColorParam, number> {
  const entry = own(config.palette, color) ?? color;
  if (typeof entry === "string") {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(entry);
    if (!match) throw new Error(`unknown colour "${color}"`);
    const pct = (part: string) => Math.round((parseInt(part, 16) / 255) * 1000) / 10;
    return { red: pct(match[1]!), green: pct(match[2]!), blue: pct(match[3]!), amber: 0, mint: 0 };
  }
  return { red: entry.red ?? 0, green: entry.green ?? 0, blue: entry.blue ?? 0, amber: entry.amber ?? 0, mint: entry.mint ?? 0 };
}

/** Eos channel → the values a look sets on it ("*" first, then named fixtures). */
export function lookTargets(config: BridgeConfig, look: Look): Map<number, ChannelValues> {
  const targets = new Map<number, ChannelValues>();
  const apply = (channel: number, state: { color?: string | undefined; level?: number | undefined }) => {
    const values: ChannelValues = { ...targets.get(channel) };
    if (state.level !== undefined) values.intens = state.level;
    if (state.color !== undefined) Object.assign(values, resolveColor(config, state.color));
    targets.set(channel, values);
  };
  const all = look.fixtures["*"];
  if (all) for (const fixture of Object.values(config.fixtures)) apply(fixture.channel, all);
  for (const [fixture, state] of Object.entries(look.fixtures)) {
    if (fixture === "*") continue;
    const entry = own(config.fixtures, fixture);
    if (!entry) throw new Error(`unknown fixture "${fixture}"`);
    apply(entry.channel, state);
  }
  return targets;
}
