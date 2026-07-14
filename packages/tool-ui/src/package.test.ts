import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  exports: Record<string, string>;
  sideEffects: string[];
};

describe("package boundaries", () => {
  it("keeps JavaScript imports free of stylesheet side effects", () => {
    const indexSource = readFileSync(new URL("index.ts", import.meta.url), "utf8");
    const iconSource = readFileSync(new URL("status-icon.ts", import.meta.url), "utf8");
    expect(indexSource).not.toMatch(/\.css["']/);
    expect(iconSource).not.toMatch(/\.css["']/);
    expect(packageJson.sideEffects).toEqual(["**/*.css"]);
  });

  it("exports each public stylesheet explicitly", () => {
    expect(packageJson.exports).toEqual({
      ".": "./src/index.ts",
      "./base.css": "./src/base.css",
      "./fonts.css": "./src/fonts.css",
      "./graph.css": "./src/graph.css",
      "./primitives.css": "./src/primitives.css",
      "./styles.css": "./src/styles.css",
      "./tokens.css": "./src/tokens.css",
    });
  });
});
