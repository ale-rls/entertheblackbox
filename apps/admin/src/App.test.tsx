// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App, normalizeError, type Status } from "./App.js";

const activeStatus: Status = {
  healthy: true,
  ready: true,
  uptimeMs: 3_723_000,
  displayConnected: true,
  displayHeartbeatAgeMs: 42,
  connectedParticipants: 118,
  sessionId: "5H7D-A2",
  lifecycle: "active",
  phaseId: "question-02",
  phaseEpoch: 7,
};

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function renderApp() {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => { root?.render(<App />); });
  await flush();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return match;
}

function createAdminFetch(options?: { errors?: unknown[]; status?: Status; rejectAction?: string }) {
  const requests: Array<{ url: string; method: string }> = [];
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    if (url.endsWith("/status")) return jsonResponse(options?.status ?? activeStatus);
    if (url.endsWith("/errors")) return jsonResponse({ errors: options?.errors ?? [] });
    if (url.includes("/export?format=csv")) return new Response("id\n5H7D-A2", { headers: { "Content-Type": "text/csv" } });
    if (method === "POST" && url.endsWith(`/${options?.rejectAction ?? "\0"}`)) return jsonResponse({ ok: false, reason: "wrong-phase" }, 409);
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", mock);
  return { mock, requests };
}

describe("Admin operations UI", () => {
  it("shows an honest unauthenticated state without requesting or fabricating operational data", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await renderApp();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-sc-tool-root]")?.getAttribute("data-sc-tool-density")).toBe("standard");
    expect(document.body.textContent).toContain("Connect to load live status");
    expect(document.body.textContent).not.toContain("118");
    expect(document.body.textContent).not.toContain("question-02");
  });

  it("stores a submitted token, authenticates, fetches both resources, and polls every two seconds", async () => {
    const { requests } = createAdminFetch();
    const intervalSpy = vi.spyOn(window, "setInterval");
    await renderApp();

    const token = document.querySelector<HTMLInputElement>("#admin-token")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(token, "operator-secret");
      token.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Connect").click(); });
    await flush();

    expect(sessionStorage.getItem("admin-token")).toBe("operator-secret");
    expect(requests).toEqual(expect.arrayContaining([
      { url: "/api/admin/status", method: "GET" },
      { url: "/api/admin/errors", method: "GET" },
    ]));
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);
    expect(document.body.textContent).toContain("System ready");
    expect(document.body.textContent).toContain("question-02");
    expect(document.body.textContent).toContain("118");
  });

  it("derives action availability, executes Skip, and confirms Restart with keyboard-safe focus", async () => {
    sessionStorage.setItem("admin-token", "operator-secret");
    const { requests } = createAdminFetch();
    await renderApp();

    expect(button("Start show").disabled).toBe(true);
    expect(button("Skip current phase").disabled).toBe(false);
    await act(async () => { button("Skip current phase").click(); });
    await flush();
    expect(requests).toContainEqual({ url: "/api/admin/skip", method: "POST" });

    const restartTrigger = button("Restart show");
    await act(async () => { restartTrigger.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Keep current show");
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Restart show");
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Keep current show");

    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(restartTrigger);

    await act(async () => { restartTrigger.click(); });
    const confirm = document.querySelector<HTMLButtonElement>('[role="alertdialog"] [data-sc-tool-variant="danger"]')!;
    await act(async () => { confirm.click(); });
    await flush();
    expect(requests).toContainEqual({ url: "/api/admin/restart", method: "POST" });
    expect(document.activeElement).toBe(restartTrigger);
  });

  it("keeps server-refused actions visible as inline failure feedback", async () => {
    sessionStorage.setItem("admin-token", "operator-secret");
    createAdminFetch({ rejectAction: "skip" });
    await renderApp();

    await act(async () => { button("Skip current phase").click(); });
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("server refused this action");
  });

  it("reports authentication failures without exposing operational placeholders", async () => {
    sessionStorage.setItem("admin-token", "bad-token");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)));
    await renderApp();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Invalid admin token");
    expect(document.body.textContent).toContain("Connect to load live status");
    expect(document.body.textContent).not.toContain("Current phase");
  });

  it("marks cached status stale after a failed poll and clears staleness on recovery", async () => {
    sessionStorage.setItem("admin-token", "operator-secret");
    let failStatus = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/status")) return failStatus ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse(activeStatus);
      return jsonResponse({ errors: [] });
    }));
    const intervalSpy = vi.spyOn(window, "setInterval");
    await renderApp();
    const poll = intervalSpy.mock.calls[0]?.[0];
    if (typeof poll !== "function") throw new Error("Polling callback was not registered");

    failStatus = true;
    await act(async () => { poll(); });
    await flush();
    expect(document.body.textContent).toContain("Status stale");
    expect(document.body.textContent).toContain("Last status received");
    expect(document.body.textContent).toContain("Showing the last received status");
    expect(document.body.textContent).toContain("question-02");

    failStatus = false;
    await act(async () => { poll(); });
    await flush();
    expect(document.body.textContent).toContain("System ready");
    expect(document.body.textContent).toContain("Authenticated");
    expect(document.body.textContent).not.toContain("Status stale");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders known and unknown recent-error payloads with a usable raw fallback", async () => {
    sessionStorage.setItem("admin-token", "operator-secret");
    createAdminFetch({ errors: [{ at: "2026-07-14T12:00:00Z", path: "/display", message: "heartbeat missed", code: 12 }, "plain failure", { nested: { reason: "unknown" } }] });
    await renderApp();

    expect(document.body.textContent).toContain("heartbeat missed");
    expect(document.body.textContent).toContain("plain failure");
    expect(document.body.textContent).toContain("Unstructured error payload");
    expect(document.querySelectorAll("details")).toHaveLength(3);
    expect(normalizeError(Symbol("unserializable"), 0).message).toBe("Unstructured error payload");
  });

  it("downloads the current session as CSV and announces completion", async () => {
    sessionStorage.setItem("admin-token", "operator-secret");
    const { requests } = createAdminFetch();
    const createObjectURL = vi.fn(() => "blob:admin-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloadName = this.download; });
    await renderApp();

    await act(async () => { button("Export CSV").click(); });
    await flush();
    expect(requests).toContainEqual({ url: "/api/admin/sessions/5H7D-A2/export?format=csv", method: "GET" });
    expect(downloadName).toBe("5H7D-A2.csv");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:admin-export");
    expect(document.body.textContent).toContain("CSV export prepared");
  });
});
