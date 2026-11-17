import { describe, expect, it } from "vitest";
import { LightingBridge } from "./bridge.js";
import { parseBridgeConfig } from "./config.js";
import type { LightOutput } from "./eos.js";
import { LookPlayer } from "./player.js";
import { lampRgb, swatches } from "./swatch.js";

const config = parseBridgeConfig(JSON.stringify({
  eos: { host: "10.0.0.1" },
  fixtures: { l1: { channel: 11 }, l2: { channel: 13 } },
  palette: { rot: { red: 100 } },
  looks: { rot: { fade: 0, fixtures: { l1: { color: "rot", level: 100 }, l2: { level: 0 } } } },
}));
const output: LightOutput = { name: "test", set: () => true, close: () => {} };

describe("colour swatches", () => {
  it("mixes the emitters for the hue and dims by level", () => {
    expect(lampRgb({ intens: 100, red: 100, green: 0, blue: 0, amber: 0, mint: 0 })).toEqual([255, 0, 0]);
    expect(lampRgb({ intens: 100, red: 100, green: 100, blue: 100, amber: 0, mint: 0 })).toEqual([255, 255, 255]);
    const dim = lampRgb({ intens: 25, blue: 100 })!;
    expect(dim[2]).toBeGreaterThan(100); // still visible at 25 %
    expect(dim[2]).toBeLessThan(255);
    expect(lampRgb({ intens: 100, red: 50 })![0]).toBeLessThan(255); // a weak emitter is a dimmer lamp
  });

  it("an off lamp has no colour, and one whose colour was never set is white", () => {
    expect(lampRgb({ intens: 0, red: 100 })).toBeNull();
    expect(lampRgb({ red: 100 })).toBeNull();
    expect(lampRgb({ intens: 100 })).toEqual([255, 255, 255]);
  });

  it("one per lamp in the file's order: colour, off, or not set yet", () => {
    const line = swatches(config, (channel) => (channel === 11 ? { intens: 100, red: 100 } : undefined));
    expect(line).toBe("l1 \x1b[48;2;255;0;0m  \x1b[0m l2 \x1b[2m··\x1b[0m");
    expect(swatches(config, () => ({ intens: 0 }))).toBe("l1 \x1b[2m--\x1b[0m l2 \x1b[2m--\x1b[0m");
  });

  it("the look's log line carries them only when asked", () => {
    for (const show of [true, false]) {
      const lines: string[] = [];
      const bridge = new LightingBridge(config, new LookPlayer(output), (line) => lines.push(line), undefined, undefined, show);
      bridge.test("rot");
      const line = lines.find((entry) => entry.includes('look "rot"'))!;
      expect(line.endsWith("l1 \x1b[48;2;255;0;0m  \x1b[0m l2 \x1b[2m--\x1b[0m")).toBe(show);
      expect(line.includes("\x1b[")).toBe(show);
    }
  });
});
