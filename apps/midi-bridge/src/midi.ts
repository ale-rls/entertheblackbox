import type { MidiOutput } from "./bridge.js";

type NativeOutput = {
  getPortCount(): number;
  getPortName(port: number): string;
  openPort(port: number): void;
  sendMessage(message: number[]): void;
  closePort(): void;
};

async function nativeOutput(): Promise<NativeOutput> {
  try {
    const midi = await import("@julusian/midi") as unknown as { Output: new () => NativeOutput };
    return new midi.Output();
  } catch (error) {
    throw new Error(`MIDI is not available on this machine (${error instanceof Error ? error.message : String(error)}). Use --dry-run to test without MIDI.`);
  }
}

export async function listOutputs(): Promise<string[]> {
  const output = await nativeOutput();
  return Array.from({ length: output.getPortCount() }, (_, index) => output.getPortName(index));
}

/** Open the first MIDI output whose name contains `match` (case-insensitive). */
export async function openOutput(match: string): Promise<MidiOutput & { close: () => void }> {
  const output = await nativeOutput();
  const names = Array.from({ length: output.getPortCount() }, (_, index) => output.getPortName(index));
  const index = names.findIndex((name) => name.toLowerCase().includes(match.toLowerCase()));
  if (index < 0) {
    throw new Error(`No MIDI output matching "${match}". Available: ${names.length ? names.join(", ") : "none"}. `
      + "On a Mac, enable the IAC Driver in Audio MIDI Setup (Window → Show MIDI Studio → IAC Driver → Device is online).");
  }
  output.openPort(index);
  return { name: names[index]!, send: (bytes) => output.sendMessage(bytes), close: () => output.closePort() };
}

/** Prints MIDI instead of sending it. */
export function dryRunOutput(log: (line: string) => void): MidiOutput & { close: () => void } {
  return {
    name: "dry run (no MIDI sent)",
    send: (bytes) => log(`  midi ${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}`),
    close: () => {},
  };
}
