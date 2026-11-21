// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { OperatorFields } from "./OperatorFields.js";

let root: Root | null = null;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });

const square = (x: number) => [{ x, y: 0 }, { x: x + 0.4, y: 0 }, { x: x + 0.4, y: 1 }, { x, y: 1 }];
const fields = { zones: [{ id: "ja", label: "JA", color: "#30a46c", points: square(0) }, { id: "nein", label: "NEIN", points: square(0.6) }], total: 12 };

describe("OperatorFields", () => {
  it("lights only the target field and shows the counter", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    await act(async () => root?.render(<OperatorFields fields={fields} state={{ target: "ja", count: 3 }} />));
    expect(document.querySelector('[data-zone="ja"]')?.getAttribute("data-lit")).toBe("true");
    expect(document.querySelector('[data-zone="nein"]')?.getAttribute("data-lit")).toBe("false");
    expect(document.querySelector('[data-zone="ja"] polygon')?.getAttribute("fill")).toBe("#30a46c");
    expect(document.querySelector(".operator-fields-count")?.textContent).toBe("3 / 12");
  });
});
