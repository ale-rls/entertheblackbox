import type { BridgeConfig, ChannelValues, ColorParam } from "./config.js";

/**
 * Roughly what each emitter looks like on a screen. Amber and mint have no exact
 * screen colour, so the swatches are a monitoring aid, not a colour match.
 */
const EMITTER_RGB: Record<ColorParam, readonly [number, number, number]> = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  amber: [255, 170, 0],
  mint: [170, 255, 195],
};

/**
 * Screen colour for one lamp, or null when it is off. Emitters are mixed for the hue;
 * brightness is intensity × the strongest emitter, gamma-encoded so 25 % stays visible.
 * A lamp whose colour was never set counts as white.
 */
export function lampRgb(values: ChannelValues): [number, number, number] | null {
  const intens = values.intens ?? 0;
  const mix = [0, 0, 0];
  let strongest = 0;
  let anyColour = false;
  for (const [param, rgb] of Object.entries(EMITTER_RGB) as Array<[ColorParam, readonly number[]]>) {
    const level = values[param];
    if (level === undefined) continue;
    anyColour = true;
    strongest = Math.max(strongest, level);
    for (let i = 0; i < 3; i++) mix[i]! += (rgb[i]! * level) / 100;
  }
  if (!anyColour) { mix.fill(255); strongest = 100; }
  const brightness = ((intens / 100) * (strongest / 100)) ** (1 / 2.2);
  const peak = Math.max(...mix);
  if (brightness <= 0 || peak <= 0) return null;
  return mix.map((channel) => Math.round((channel / peak) * 255 * brightness)) as [number, number, number];
}

/**
 * One short swatch per fixture in the lighting file's order, e.g. "l1 ██ l2 ██ l3 -- l4 ··",
 * from what the looks want each channel to end at. "--" is off, "··" not set yet.
 */
export function swatches(config: BridgeConfig, state: (channel: number) => ChannelValues | undefined): string {
  return Object.entries(config.fixtures).map(([name, fixture]) => {
    const values = state(fixture.channel);
    if (!values) return `${name} \x1b[2m··\x1b[0m`;
    const rgb = lampRgb(values);
    return rgb ? `${name} \x1b[48;2;${rgb.join(";")}m  \x1b[0m` : `${name} \x1b[2m--\x1b[0m`;
  }).join(" ");
}
