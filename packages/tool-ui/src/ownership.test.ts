import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const studioApp = read("../../../apps/studio/src/App.tsx");
const studioStyles = read("../../../apps/studio/src/style.css");
const adminMain = read("../../../apps/admin/src/main.tsx");
const adminApp = read("../../../apps/admin/src/App.tsx");
const adminStyles = read("../../../apps/admin/src/admin.css");

describe("shared tool style ownership", () => {
  it("loads the same public stylesheet in Studio and Admin", () => {
    expect(studioApp).toContain('import "@smartphonecracy/tool-ui/styles.css"');
    expect(adminMain).toContain('import "@smartphonecracy/tool-ui/styles.css"');
  });

  it("uses shared semantic text roles in both applications", () => {
    for (const source of [studioApp, adminApp]) {
      expect(source).toContain("sc-tool-eyebrow");
      expect(source).toContain("sc-tool-copy");
    }
    expect(studioStyles).not.toMatch(/\.eyebrow\s*\{/);
    expect(adminStyles).not.toMatch(/\.admin-(?:eyebrow|copy)\s*\{[^}]*color\s*:/);
  });

  it("keeps literal palette values out of application stylesheets", () => {
    for (const css of [studioStyles, adminStyles]) {
      expect(css).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(css).not.toMatch(/\b(?:rgb|hsl)a?\(/i);
    }
  });
});
