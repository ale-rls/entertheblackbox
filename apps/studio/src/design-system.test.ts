import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("production Studio design-system contract", () => {
  it("scopes the shared neutral compact theme to each production surface", () => {
    const app = source("./App.tsx");
    const preview = source("./preview/PreviewPanel.tsx");

    expect(app).toContain('import "@smartphonecracy/tool-ui/styles.css"');
    expect(app.match(/data-sc-tool-root/g)).toHaveLength(2);
    expect(app.match(/data-sc-tool-density="compact"/g)).toHaveLength(2);
    expect(app).toContain('ariaLabel: "Show entry"');
    expect(app).toContain('ariaLabel: "Show end"');
    expect(app).toContain('[node.className, "invalid"].filter(Boolean).join(" ")');
    expect(app).toContain('window.scrollTo({ top: 0, left: 0 })');
    expect(preview).toContain('data-sc-tool-root');
    expect(preview).toContain('data-sc-tool-density="compact"');
    expect(app).not.toContain("Admin");
  });

  it("marks the real phase domains and state hooks without flooding node bodies", () => {
    const nodes = source("./canvas/nodes.tsx");

    expect(nodes).toContain('data-sc-tool-domain={value.kind === "position-question" ? "question" : value.kind}');
    expect(nodes).toContain('data-sc-tool-domain="entry"');
    expect(nodes).toContain('data-sc-tool-domain="idle"');
    expect(nodes).toContain("data-sc-tool-dragging={dragging}");
    expect(nodes).toContain("data-selected={selected}");
    expect(nodes).toContain('data-port-tone={tone ?? "default"}');
    expect(nodes).not.toContain("aria-selected={selected}");
  });

  it("uses shared neutral tokens and preserves responsive accessibility states", () => {
    const styles = source("./style.css");

    for (const token of [
      "--sc-tool-color-canvas",
      "--sc-tool-color-surface-1",
      "--sc-tool-color-surface-2",
      "--sc-tool-color-surface-3",
      "--sc-tool-color-domain-entry",
      "--sc-tool-color-domain-question",
      "--sc-tool-color-domain-branch",
    ]) expect(styles).toContain(token);

    expect(styles).toContain("@media (max-width: 700px)");
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("body:has(.editor)");
    expect(styles.match(/grid-template: auto minmax\(0, 1fr\) auto \/ minmax\(0, 1fr\)/g)).toHaveLength(2);
    expect(styles).not.toContain("minmax(18rem, 1fr)");
    expect(styles).toContain("max-height: min(15rem, 28dvh)");
    expect(styles).toContain("grid-row: 2");
    expect(styles).not.toContain("overflow-x: hidden");
    expect(styles).not.toContain("inset: 3.5rem");
    expect(styles).toContain("@media (pointer: coarse)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).not.toContain("--blue:");
    expect(styles).not.toContain("--bg:");
  });
});
