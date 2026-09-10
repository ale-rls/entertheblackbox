// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const pocketbaseAuth = vi.hoisted(() => ({ authWithPassword: vi.fn() }));

vi.mock("pocketbase", () => ({
  default: class {
    authStore = { token: "" };
    collection() {
      return {
        authWithPassword: async (email: string, password: string) => {
          const result = await pocketbaseAuth.authWithPassword(email, password);
          this.authStore.token = result.token;
          return result;
        },
      };
    }
  },
}));

import { App, type Status } from "./App.js";

const activeStatus: Status = {
  healthy: true,
  ready: true,
  uptimeMs: 3_723_000,
  displayConnected: true,
  displayHeartbeatAgeMs: 42,
  displayPlaybackIssue: null,
  connectedParticipants: 118,
  participants: [],
  sessionId: "5H7D-A2",
  lifecycle: "active",
  phaseId: "question-02",
  phaseEpoch: 7,
};

const sceneFlow = {
  entryPhaseId: "intro",
  scenes: [
    { id: "intro", kind: "video", title: "Opening film", routes: [{ outcome: "next", target: "question-02" }] },
    { id: "question-02", kind: "position-question", title: "Choose a position", routes: [{ outcome: "next", target: "idle" }] },
  ],
};

let root: Root | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  pocketbaseAuth.authWithPassword.mockReset();
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

function createAdminFetch(options?: { status?: Status; rejectAction?: string }) {
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/status")) return jsonResponse(options?.status ?? activeStatus);
    if (url.endsWith("/flow")) return jsonResponse(sceneFlow);
    if (url.endsWith("/shows") && method === "GET") {
      return jsonResponse({ active: "show-a", pending: null, shows: [{ showId: "show-a", name: "Election night", version: "1.0.0", publishedAt: 1_000 }] });
    }
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

  it("signs in via PocketBase, stores the resulting token, fetches status, and polls every two seconds", async () => {
    pocketbaseAuth.authWithPassword.mockResolvedValue({
      token: "pb-operator-token",
      record: { id: "op1", email: "operator@smartphonecracy.local", role: "operator" },
    });
    const { requests } = createAdminFetch();
    const intervalSpy = vi.spyOn(window, "setInterval");
    await renderApp();

    const email = document.querySelector<HTMLInputElement>("#admin-email")!;
    const password = document.querySelector<HTMLInputElement>("#admin-password")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(email, "operator@smartphonecracy.local");
      email.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(password, "operator-secret");
      password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Sign in").click(); });
    await flush();

    expect(pocketbaseAuth.authWithPassword).toHaveBeenCalledWith("operator@smartphonecracy.local", "operator-secret");
    expect(localStorage.getItem("admin-token")).toBe("pb-operator-token");
    expect(requests).toContainEqual({ url: "/api/admin/status", method: "GET" });
    expect(requests.some(({ url }) => url === "/api/admin/errors")).toBe(false);
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);
    expect(document.body.textContent).toContain("System ready");
    expect(document.body.textContent).toContain("question-02");
    expect(document.body.textContent).toContain("118");
  });

  it("derives action availability, executes Skip, and confirms Restart with keyboard-safe focus", async () => {
    localStorage.setItem("admin-token", "operator-secret");
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

  it("shows the published flow and confirms a direct jump to any other scene", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    const { requests } = createAdminFetch();
    await renderApp();

    expect(document.body.textContent).toContain("Scene navigator");
    expect(document.body.textContent).toContain("Opening film");
    expect(document.body.textContent).toContain("next → question-02");
    const current = document.querySelector<HTMLButtonElement>('[aria-current="step"]')!;
    expect(current.disabled).toBe(true);
    expect(current.textContent).toContain("Choose a position");

    const opening = document.querySelector<HTMLButtonElement>('[aria-label="Opening film, jump to this scene"]')!;
    await act(async () => { opening.click(); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Jump to “Opening film”?");
    await act(async () => { button("Jump to scene").click(); });
    await flush();

    expect(requests).toContainEqual({
      url: "/api/admin/jump",
      method: "POST",
      body: JSON.stringify({ phaseId: "intro" }),
    });
    expect(document.body.textContent).toContain("Jumped to “Opening film”.");
  });

  it("adds a show start five minutes from now and keeps the scene navigator last", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { requests } = createAdminFetch();
    await renderApp();

    await act(async () => { button("Add show in 5 minutes").click(); });
    await flush();

    expect(requests).toContainEqual({
      url: "/api/admin/lobby",
      method: "POST",
      body: JSON.stringify({ startTimes: [1_300_000] }),
    });
    expect(document.body.textContent).toContain("Show added in 5 minutes.");

    const panels = Array.from(document.querySelectorAll(".admin-grid > section"));
    expect(panels.at(-1)?.querySelector("#admin-flow-heading")).not.toBeNull();
  });

  it("keeps server-refused actions visible as inline failure feedback", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    createAdminFetch({ rejectAction: "skip" });
    await renderApp();

    await act(async () => { button("Skip current phase").click(); });
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("server refused this action");
  });

  it("surfaces a blocked phase video as a live operational failure", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    createAdminFetch({
      status: {
        ...activeStatus,
        displayPlaybackIssue: {
          status: "autoplay-blocked",
          mediaId: "media/intro.mp4",
          detail: "NotAllowedError: User gesture required",
          reportedAt: 1_000,
        },
      },
    });

    await renderApp();

    expect(document.body.textContent).toContain("Playback issue");
    expect(document.body.textContent).toContain("AUTOPLAY-BLOCKED");
    expect(document.body.textContent).toContain("media/intro.mp4: NotAllowedError: User gesture required");
  });

  it("reports authentication failures without exposing operational placeholders", async () => {
    localStorage.setItem("admin-token", "bad-token");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)));
    await renderApp();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Your session has expired. Sign in again.");
    expect(document.body.textContent).toContain("Connect to load live status");
    expect(document.body.textContent).not.toContain("Current phase");
  });

  it("marks cached status stale after a failed poll and clears staleness on recovery", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    let failStatus = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/status")) return failStatus ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse(activeStatus);
      if (url.endsWith("/installation")) return jsonResponse({ active: { installationId: "dev-installation", roomId: "main" }, pending: null });
      return jsonResponse({ ok: true });
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

  it("shows the active show and saves a pending selection", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (url.endsWith("/status")) return jsonResponse(activeStatus);
      if (url.endsWith("/shows") && method === "GET") {
        return jsonResponse({
          active: "show-a", pending: null,
          shows: [
            { showId: "show-a", name: "Election night", version: "1.0.0", publishedAt: 1_000 },
            { showId: "show-b", name: "Housing town hall", version: "2.0.0", publishedAt: 2_000 },
          ],
        });
      }
      if (url.endsWith("/shows") && method === "POST") return jsonResponse({ ok: true, pending: "show-b" });
      return jsonResponse({ ok: true });
    }));
    await renderApp();

    expect(document.body.textContent).toContain("Election night (1.0.0)");

    const select = document.querySelector<HTMLSelectElement>("#active-show")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(select, "show-b");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const saveShowButton = select.closest("form")!.querySelector<HTMLButtonElement>("button[type=submit]")!;
    await act(async () => { saveShowButton.click(); });
    await flush();

    const saveRequest = requests.find(({ url, method }) => url.endsWith("/shows") && method === "POST");
    expect(saveRequest?.body).toBe(JSON.stringify({ showId: "show-b" }));
    expect(document.body.textContent).toContain("queued until the current show ends");
  });

  it("does not present inactive recent-error or session-export features", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    const { requests } = createAdminFetch();
    await renderApp();

    expect(document.body.textContent).not.toContain("Recent errors");
    expect(document.body.textContent).not.toContain("Session export");
    expect(requests.some(({ url }) => url.includes("/errors") || url.includes("/export"))).toBe(false);
  });
});
