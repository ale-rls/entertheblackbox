import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhoneCount } from "./PhoneCount.js";

describe("PhoneCount", () => {
  it("renders the connected phone count", () => {
    expect(renderToStaticMarkup(<PhoneCount count={12} />)).toBe(
      '<div class="phone-count">12 phones connected</div>',
    );
  });
});
