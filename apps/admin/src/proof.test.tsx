import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminProof } from "./proof.js";

describe("Admin design proof", () => {
  it("renders the real operator flow at standard density", () => {
    const html = renderToStaticMarkup(<AdminProof />);
    expect(html).toContain('data-sc-tool-density="standard"');
    expect(html).toContain("Admin connection");
    expect(html).toContain("Operational status");
    expect(html).toContain("Start show");
    expect(html).toContain("Skip current phase");
    expect(html).toContain("Return to idle");
    expect(html).toContain("Restart show");
    expect(html).toContain("Session export");
    expect(html).toContain("Recent errors");
    expect(html).not.toContain("Advance phase");
    expect(html).not.toContain("Pause session");
    expect(html).not.toContain("End session");
    expect(html).not.toContain("Show Studio");
  });
});
