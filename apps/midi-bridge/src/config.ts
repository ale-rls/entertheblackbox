import { z } from "zod";

const midiValue = z.number().int().min(0).max(127);
const channel = z.number().int().min(1).max(16);

/** One MIDI message. Channels are 1–16 as Ableton shows them. */
export const midiActionSchema = z.union([
  z.object({
    /** Note number, 0–127 (60 = C3 in Ableton). Sent as note on, then note off after `durationMs`. */
    note: midiValue,
    velocity: z.number().int().min(1).max(127).optional(),
    channel: channel.optional(),
    durationMs: z.number().int().min(1).max(10_000).optional(),
  }).strict(),
  z.object({
    /** Control change number, 0–127. */
    cc: midiValue,
    value: midiValue,
    channel: channel.optional(),
  }).strict(),
  z.object({
    /** Program change, 0–127. */
    program: midiValue,
    channel: channel.optional(),
  }).strict(),
]);
export type MidiAction = z.infer<typeof midiActionSchema>;

const actions = z.array(midiActionSchema).min(1);

export const bridgeConfigSchema = z.object({
  /** Part of the MIDI output's name, e.g. "IAC" for "IAC Driver Bus 1". */
  output: z.string().min(1).default("IAC"),
  /** Default channel for actions that do not name one. */
  channel: channel.default(1),
  /** Outgoing cue name (Studio → scene → outgoing cues) → MIDI. */
  cues: z.record(z.string().min(1), actions).default({}),
  /** Scene ID → MIDI, sent when that scene starts. */
  scenes: z.record(z.string().min(1), actions).default({}),
  /** Sent when the show ends or is restarted (returns to idle). */
  showEnd: actions.optional(),
}).strict();
export type BridgeConfig = z.infer<typeof bridgeConfigSchema>;

/** Parse a mapping file, with readable errors. */
export function parseBridgeConfig(raw: string): BridgeConfig {
  let json: unknown;
  try { json = JSON.parse(raw); } catch (error) {
    throw new Error(`Mapping file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = bridgeConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Mapping file is invalid:\n${parsed.error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n")}`);
  }
  return parsed.data;
}

const NOTE_ON = 0x90, NOTE_OFF = 0x80, CONTROL_CHANGE = 0xb0, PROGRAM_CHANGE = 0xc0;

/** Raw MIDI bytes for an action: the immediate message, plus a note off for notes. */
export function midiBytes(action: MidiAction, defaultChannel: number): { now: number[]; off?: { bytes: number[]; afterMs: number } } {
  const status = (kind: number) => kind | ((action.channel ?? defaultChannel) - 1);
  if ("note" in action) {
    return {
      now: [status(NOTE_ON), action.note, action.velocity ?? 127],
      off: { bytes: [status(NOTE_OFF), action.note, 0], afterMs: action.durationMs ?? 100 },
    };
  }
  if ("cc" in action) return { now: [status(CONTROL_CHANGE), action.cc, action.value] };
  return { now: [status(PROGRAM_CHANGE), action.program] };
}

/** Short human description, e.g. "note 60 ch1", for the log. */
export function describeAction(action: MidiAction, defaultChannel: number): string {
  const ch = `ch${action.channel ?? defaultChannel}`;
  if ("note" in action) return `note ${action.note} ${ch}`;
  if ("cc" in action) return `CC ${action.cc}=${action.value} ${ch}`;
  return `program ${action.program} ${ch}`;
}
