import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioProof } from "./proof.js";

describe("Show Studio design proof", () => {
  it("renders the real compact authoring flow", () => {
    const html = renderToStaticMarkup(<StudioProof />);
    expect(html).toContain('data-sc-tool-density="compact"');
    expect(html).toContain("File");
    expect(html).toContain("Edit");
    expect(html).toContain("View");
    expect(html).toContain("Add");
    expect(html).toContain("Saved");
    expect(html).toContain("Export blocked");
    expect(html).toContain("Scenario graph");
    expect(html).toContain("Properties");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("Preview show");
    expect(html).toContain("Question");
    expect(html).toContain('value="four-quadrant"');
    expect(html).toContain('value="two-quadrant-x"');
    expect(html).toContain('value="two-quadrant-y"');
    expect(html).not.toContain("Prompt");
    expect(html).not.toContain("Single axis");
    expect(html).not.toContain("Delete node");
    expect(html).not.toContain("resolve-groups");
    expect(html).not.toContain('data-sc-tool-domain="branch"');
    expect(html).not.toContain("Admin connection");
  });
});
