import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusIcon, type ToolStatus } from "./index.js";

describe("StatusIcon", () => {
  const statuses: ToolStatus[] = ["info", "success", "warning", "danger"];

  it.each(statuses)("renders semantic %s markup", (status) => {
    const markup = renderToStaticMarkup(
      StatusIcon({ status, label: `${status} state` }),
    );
    expect(markup).toContain(`<svg`);
    expect(markup).toContain(`data-sc-tool-status="${status}"`);
    expect(markup).toContain(`role="img"`);
    expect(markup).toContain(`aria-label="${status} state"`);
    expect(markup).toContain(`focusable="false"`);
    expect(markup).not.toContain("<title");
  });

  it("is hidden from assistive technology beside visible text", () => {
    const markup = renderToStaticMarkup(StatusIcon({ status: "success" }));
    expect(markup).toContain(`aria-hidden="true"`);
    expect(markup).not.toContain(`role="img"`);
    expect(markup).not.toContain(`aria-label=`);
  });

  it("adds consumer classes without replacing its stable class", () => {
    const markup = renderToStaticMarkup(
      StatusIcon({ status: "danger", className: "validation-glyph" }),
    );
    expect(markup).toContain(
      `class="sc-tool-status-icon validation-glyph"`,
    );
  });
});
