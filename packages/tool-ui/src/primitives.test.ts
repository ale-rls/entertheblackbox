import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const primitives = readFileSync(new URL("primitives.css", import.meta.url), "utf8");
const base = readFileSync(new URL("base.css", import.meta.url), "utf8");

function ruleBody(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

describe("native-element CSS contracts", () => {
  it("keeps shared text roles on Studio's muted hierarchy", () => {
    const eyebrow = ruleBody(base, ".sc-tool-eyebrow");
    const copy = ruleBody(base, ".sc-tool-copy");
    expect(eyebrow).toContain("color: var(--sc-tool-color-text-muted);");
    expect(eyebrow).toContain("font-family: var(--sc-tool-font-mono);");
    expect(copy).toContain("color: var(--sc-tool-color-text-muted);");
    expect(copy).not.toContain("var(--sc-tool-color-text-secondary)");
  });

  it("centers button-styled file-import labels with a real flex box", () => {
    const button = ruleBody(primitives, ".sc-tool-button");
    expect(button).toContain("display: inline-flex;");
    expect(button).toContain("align-items: center;");
    expect(button).toContain("justify-content: center;");
    expect(button).toContain("gap: var(--sc-tool-space-2);");
  });

  it("gives menu items explicit interactive and disabled pointer treatment", () => {
    expect(ruleBody(primitives, ".sc-tool-menu-item")).toContain("cursor: pointer;");
    const disabled = ruleBody(primitives, ".sc-tool-menu-item:disabled");
    expect(disabled).toContain("color: var(--sc-tool-color-text-muted);");
    expect(disabled).toContain("cursor: not-allowed;");
  });

  it("removes button press transforms when reduced motion is requested", () => {
    const reducedMotion = base.match(
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]+?)\n\}/,
    )?.[1];
    expect(reducedMotion).toContain(".sc-tool-button:active");
    expect(reducedMotion).toContain("transform: none !important;");
  });
});
