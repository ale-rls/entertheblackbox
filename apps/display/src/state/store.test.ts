import { describe, expect, it } from "vitest";
import { displayReducer, initialDisplayState } from "./store.js";

describe("displayReducer monitor backgrounds", () => {
  it("keeps the operator's latest live monitor colours", () => {
    const set = displayReducer(initialDisplayState, { type: "server-message", message: { t: "monitor_backgrounds", v: 2, colors: { M1: "#30a46c" } } });
    expect(set.monitorBackgrounds).toEqual({ M1: "#30a46c" });
    const cleared = displayReducer(set, { type: "server-message", message: { t: "monitor_backgrounds", v: 2, colors: {} } });
    expect(cleared.monitorBackgrounds).toEqual({});
  });
});
