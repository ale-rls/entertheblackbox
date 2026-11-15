import { describe, expect, it } from "vitest";
import { applyDisplayFit, parseDisplayFit } from "./displayFit.js";

describe("display fit", () => {
  it("defaults to the letterboxed 16:9 frame", () => {
    expect(parseDisplayFit("")).toBe("contain");
    expect(parseDisplayFit("?fit=stretch")).toBe("contain");
  });

  it("accepts each supported mode", () => {
    for (const fit of ["contain", "height", "width"]) expect(parseDisplayFit(`?group=a&fit=${fit}`)).toBe(fit);
  });

  it("marks the document root for the stylesheet", () => {
    const root = { dataset: {} as DOMStringMap };
    applyDisplayFit(root, "?fit=height");
    expect(root.dataset.fit).toBe("height");
  });
});
