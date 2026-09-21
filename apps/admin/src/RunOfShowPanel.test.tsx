// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RunOfShowPanel } from "./RunOfShowPanel.js";

it("lists the URLs an operator needs, grouped by machine, with copy for the live ones", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<RunOfShowPanel />); });
    expect(host.textContent).toContain("Installation machine");
    expect(host.textContent).toContain("Operator machine");
    expect(host.textContent).toContain("Participant phones");
    expect(host.textContent).toContain("Tracking machine");
    // The display URL is a fill-in-the-blanks pattern, not a fabricated value.
    expect(host.textContent).toContain("<installation-id>");
    expect(host.textContent).toContain("DISPLAY_TOKEN");

    const copyButtons = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Copy");
    expect(copyButtons).toHaveLength(3); // dashboard, audio diagnostics, phone join
    await act(async () => { copyButtons[0]!.click(); });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/admin/`);
    expect(copyButtons[0]!.textContent).toBe("Copied");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
