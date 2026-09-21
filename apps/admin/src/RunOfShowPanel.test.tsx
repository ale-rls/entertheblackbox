// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RunOfShowPanel } from "./RunOfShowPanel.js";

it("provides direct show-tool links and brief audience guidance", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<RunOfShowPanel />);
  expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["/studio/", "/admin/?view=audio", "/phone/"]);
  expect(host.textContent).toContain("QR code");
  expect(host.textContent).not.toContain("DISPLAY_TOKEN");
});
