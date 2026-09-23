// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

const qr = vi.hoisted(() => ({ toDataURL: vi.fn() }));
vi.mock("qrcode", () => ({ default: qr }));
import { RunOfShowPanel } from "./RunOfShowPanel.js";

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.replaceChildren();
  qr.toDataURL.mockReset();
  vi.restoreAllMocks();
});

it("provides direct show-tool links and brief audience guidance", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<RunOfShowPanel phoneJoinUrl="https://show.example/phone/" />));
  expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["/studio/", "/admin/?view=audio", "/phone/"]);
  expect(host.textContent).toContain("QR code");
  expect(host.textContent).toContain("Download join QR (PNG)");
  expect(host.textContent).not.toContain("DISPLAY_TOKEN");
  act(() => root.unmount());
});

it("downloads a high-resolution PNG containing the configured phone URL", async () => {
  qr.toDataURL.mockResolvedValue("data:image/png;base64,exported");
  let downloadedHref = "";
  let downloadedName = "";
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloadedHref = this.href;
    downloadedName = this.download;
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<RunOfShowPanel phoneJoinUrl="https://show.example/phone/" />));

  await act(async () => {
    (host.querySelector("button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
  });

  expect(qr.toDataURL).toHaveBeenCalledWith("https://show.example/phone/", expect.objectContaining({ type: "image/png", width: 1024, margin: 4 }));
  expect(downloadedHref).toBe("data:image/png;base64,exported");
  expect(downloadedName).toBe("enter-the-blackbox-join-qr.png");
  expect(host.textContent).toContain("Downloaded enter-the-blackbox-join-qr.png.");
  act(() => root.unmount());
});

it("exports an operator override without changing the configured URL", async () => {
  qr.toDataURL.mockResolvedValue("data:image/png;base64,override");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<RunOfShowPanel phoneJoinUrl="https://show.example/phone/" />));
  const input = host.querySelector("input") as HTMLInputElement;

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  https://alternate.example/special-join  ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const download = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === "Download join QR (PNG)") as HTMLButtonElement;
  await act(async () => {
    download.click();
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
  });

  expect(qr.toDataURL).toHaveBeenCalledWith("https://alternate.example/special-join", expect.any(Object));
  expect(input.value).toBe("https://alternate.example/special-join");
  act(() => root.unmount());
});

it("rejects invalid overrides and can restore the configured URL", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<RunOfShowPanel phoneJoinUrl="https://show.example/phone/" />));
  const input = host.querySelector("input") as HTMLInputElement;

  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "javascript:alert(1)");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const buttons = [...host.querySelectorAll("button")];
  const download = buttons.find((candidate) => candidate.textContent === "Download join QR (PNG)") as HTMLButtonElement;
  const reset = buttons.find((candidate) => candidate.textContent === "Use configured URL") as HTMLButtonElement;
  expect(download.disabled).toBe(true);
  expect(host.textContent).toContain("Enter a valid HTTP or HTTPS URL.");

  act(() => reset.click());
  expect(input.value).toBe("https://show.example/phone/");
  expect(download.disabled).toBe(false);
  act(() => root.unmount());
});
