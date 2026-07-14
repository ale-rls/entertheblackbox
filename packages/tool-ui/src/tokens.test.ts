import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cssFiles = [
  "base.css",
  "fonts.css",
  "graph.css",
  "primitives.css",
  "styles.css",
  "tokens.css",
] as const;

const readCss = (name: (typeof cssFiles)[number]) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

function declarations(css: string) {
  return Object.fromEntries(
    [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [
      match[1],
      match[2]?.trim(),
    ]),
  );
}

const expectedTokens: Record<string, string> = {
  "--sc-tool-color-canvas": "#12100D",
  "--sc-tool-color-surface-1": "#181510",
  "--sc-tool-color-surface-2": "#211D16",
  "--sc-tool-color-surface-3": "#2B261D",
  "--sc-tool-color-scrim": "rgb(18 16 13 / 78%)",
  "--sc-tool-color-cream-strong": "#F7EDDA",
  "--sc-tool-color-text": "#F4E9D1",
  "--sc-tool-color-text-secondary": "#C7BCA5",
  "--sc-tool-color-text-muted": "#A79C87",
  "--sc-tool-color-text-on-cream": "#17130E",
  "--sc-tool-color-text-muted-on-cream": "#665E50",
  "--sc-tool-color-rule": "#494236",
  "--sc-tool-color-rule-strong": "#7A705D",
  "--sc-tool-color-action": "#E8DDC4",
  "--sc-tool-color-action-hover": "#F4E9D1",
  "--sc-tool-color-action-pressed": "#D2C6AC",
  "--sc-tool-color-focus-on-dark": "#FFD166",
  "--sc-tool-color-focus-on-cream": "#3D4F70",
  "--sc-tool-color-selection": "#3A3120",
  "--sc-tool-color-info": "#72B7E4",
  "--sc-tool-color-success": "#77C593",
  "--sc-tool-color-warning": "#E9B65C",
  "--sc-tool-color-danger": "#F08072",
  "--sc-tool-color-domain-entry": "#62C6B2",
  "--sc-tool-color-domain-idle": "#B2A58D",
  "--sc-tool-color-domain-video": "#74A7E8",
  "--sc-tool-color-domain-question": "#D89DD8",
  "--sc-tool-color-domain-branch": "#E59A6F",
  "--sc-tool-font-sans": '"Space Grotesk", "Arial", sans-serif',
  "--sc-tool-font-mono": '"IBM Plex Mono", "Courier New", monospace',
  "--sc-tool-font-weight-regular": "400",
  "--sc-tool-font-weight-medium": "500",
  "--sc-tool-font-weight-semibold": "600",
  "--sc-tool-font-size-00": "0.6875rem",
  "--sc-tool-font-size-0": "0.75rem",
  "--sc-tool-font-size-1": "0.8125rem",
  "--sc-tool-font-size-2": "0.875rem",
  "--sc-tool-font-size-3": "1rem",
  "--sc-tool-font-size-4": "1.25rem",
  "--sc-tool-font-size-5": "1.75rem",
  "--sc-tool-line-height-tight": "1.15",
  "--sc-tool-line-height-ui": "1.35",
  "--sc-tool-line-height-copy": "1.55",
  "--sc-tool-letter-spacing-label": "0.04em",
  "--sc-tool-letter-spacing-data": "-0.01em",
  "--sc-tool-space-0": "0",
  "--sc-tool-space-1": "0.125rem",
  "--sc-tool-space-2": "0.25rem",
  "--sc-tool-space-3": "0.375rem",
  "--sc-tool-space-4": "0.5rem",
  "--sc-tool-space-5": "0.75rem",
  "--sc-tool-space-6": "1rem",
  "--sc-tool-space-7": "1.25rem",
  "--sc-tool-space-8": "1.5rem",
  "--sc-tool-space-9": "2rem",
  "--sc-tool-space-10": "2.5rem",
  "--sc-tool-space-11": "3rem",
  "--sc-tool-radius-0": "0",
  "--sc-tool-radius-1": "0.25rem",
  "--sc-tool-radius-2": "0.5rem",
  "--sc-tool-radius-3": "0.75rem",
  "--sc-tool-radius-pill": "999px",
  "--sc-tool-border-hairline": "1px",
  "--sc-tool-border-emphasis": "2px",
  "--sc-tool-shadow-1":
    "0 1px 0 rgb(247 237 218 / 5%), 0 8px 24px rgb(0 0 0 / 24%)",
  "--sc-tool-shadow-2":
    "0 1px 0 rgb(247 237 218 / 7%), 0 16px 48px rgb(0 0 0 / 36%)",
  "--sc-tool-duration-instant": "80ms",
  "--sc-tool-duration-fast": "140ms",
  "--sc-tool-duration-base": "200ms",
  "--sc-tool-ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
  "--sc-tool-ease-exit": "cubic-bezier(0.4, 0, 1, 1)",
  "--sc-tool-density-control-height": "2rem",
  "--sc-tool-density-control-pad-inline": "var(--sc-tool-space-4)",
  "--sc-tool-density-row-height": "2.25rem",
  "--sc-tool-density-panel-gap": "var(--sc-tool-space-4)",
  "--sc-tool-density-panel-pad": "var(--sc-tool-space-5)",
};

describe("tool token contract", () => {
  it("declares the documented token names and compact values exactly", () => {
    expect(declarations(readCss("tokens.css"))).toEqual(expectedTokens);
  });

  it("also declares the exact standard density aliases", () => {
    const standardBlock = readCss("tokens.css").match(
      /data-sc-tool-density="standard"[^}]*\{([^}]+)\}/,
    )?.[1];

    expect(standardBlock).toBeDefined();
    expect(declarations(standardBlock ?? "")).toEqual({
      "--sc-tool-density-control-height": "2.5rem",
      "--sc-tool-density-control-pad-inline": "var(--sc-tool-space-5)",
      "--sc-tool-density-row-height": "2.75rem",
      "--sc-tool-density-panel-gap": "var(--sc-tool-space-6)",
      "--sc-tool-density-panel-pad": "var(--sc-tool-space-6)",
    });
  });

  it("uses only the tools prefix for custom properties", () => {
    for (const file of cssFiles) {
      const properties = readCss(file).match(/--[a-z0-9-]+/gi) ?? [];
      expect(properties.every((property) => property.startsWith("--sc-tool-"))).toBe(
        true,
      );
    }
  });
});

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);

  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  const linear = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("documented contrast pairs", () => {
  const tokens = declarations(readCss("tokens.css"));
  const pairs = [
    ["text", "canvas", 4.5],
    ["text-secondary", "canvas", 4.5],
    ["text-muted", "canvas", 4.5],
    ["text", "surface-3", 4.5],
    ["text-on-cream", "action", 4.5],
    ["text-on-cream", "cream-strong", 4.5],
    ["text-muted-on-cream", "cream-strong", 4.5],
    ["focus-on-dark", "surface-3", 3],
    ["focus-on-cream", "cream-strong", 3],
    ["focus-on-cream", "action", 3],
    ["info", "canvas", 4.5],
    ["success", "canvas", 4.5],
    ["warning", "canvas", 4.5],
    ["danger", "canvas", 4.5],
    ["domain-entry", "surface-3", 3],
    ["domain-idle", "surface-3", 3],
    ["domain-video", "surface-3", 3],
    ["domain-question", "surface-3", 3],
    ["domain-branch", "surface-3", 3],
    ["rule-strong", "surface-3", 3],
  ] as const;

  it.each(pairs)("%s on %s meets %s:1", (foreground, background, minimum) => {
    const foregroundValue = tokens[`--sc-tool-color-${foreground}`];
    const backgroundValue = tokens[`--sc-tool-color-${background}`];
    expect(foregroundValue).toMatch(/^#[0-9A-F]{6}$/);
    expect(backgroundValue).toMatch(/^#[0-9A-F]{6}$/);
    expect(contrast(foregroundValue!, backgroundValue!)).toBeGreaterThanOrEqual(minimum);
  });
});
