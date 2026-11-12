import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const zIndex = (selector: string) => {
  const rule = new RegExp(`(^|\\n)${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
  return rule ? Number(/z-index:\s*(-?\d+)/.exec(rule[2]!)?.[1]) : undefined;
};

describe("display layers", () => {
  it("keeps the video layer, including a scene loop, under the curtain-light vote", () => {
    expect(zIndex(".layer-video")).toBe(0);
    expect(zIndex(".layer-curtain")).toBeGreaterThan(0);
  });
});
