// @vitest-environment jsdom
import { DEFAULT_DISPLAY_SETTINGS } from "@entertheblackbox/protocol";
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
  groupPathsStarted: false,
  groupPaths: [],
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
  window.history.replaceState({}, "", "/");
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

function createAdminFetch(options?: { status?: Status; rejectAction?: string; flow?: typeof sceneFlow }) {
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/settings/display")) return jsonResponse({ configured: true, display: DEFAULT_DISPLAY_SETTINGS });
    if (url.endsWith("/status")) return jsonResponse(options?.status ?? activeStatus);
    if (url.endsWith("/flow")) return jsonResponse(options?.flow ?? sceneFlow);
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
  it("provides an authenticated read-only audio page that polls only status", async () => {
    window.history.replaceState({}, "", "/admin/?view=audio");
    localStorage.setItem("admin-token", "operator-token");
    const { requests } = createAdminFetch();
    await renderApp();
    expect(document.querySelector("h1")?.textContent).toBe("Audio diagnostics");
    expect(document.body.textContent).toContain("Per-phone connectivity");
    expect(document.body.textContent).not.toContain("Start show");
    expect(requests.map(request => request.url)).toEqual(["/api/admin/status"]);
  });

  it("allows starting a show without a connected display", async () => {
    localStorage.setItem("admin-token", "operator-token");
    const { requests } = createAdminFetch({
      status: { ...activeStatus, lifecycle: "lobby", displayConnected: false },
    });
    await renderApp();
    expect(button("Start show").disabled).toBe(false);
    await act(async () => { button("Start show").click(); });
    await flush();
    expect(requests.some(request => request.method === "POST" && request.url.endsWith("/start"))).toBe(true);
    expect(document.body.textContent).not.toContain("Display must be connected");
  });

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
      record: { id: "op1", email: "operator@entertheblackbox.local", role: "operator" },
    });
    const { requests } = createAdminFetch();
    const intervalSpy = vi.spyOn(window, "setInterval");
    await renderApp();

    const email = document.querySelector<HTMLInputElement>("#admin-email")!;
    const password = document.querySelector<HTMLInputElement>("#admin-password")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(email, "operator@entertheblackbox.local");
      email.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(password, "operator-secret");
      password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Sign in").click(); });
    await flush();

    expect(pocketbaseAuth.authWithPassword).toHaveBeenCalledWith("operator@entertheblackbox.local", "operator-secret");
    expect(localStorage.getItem("admin-token")).toBe("pb-operator-token");
    expect(requests).toContainEqual({ url: "/api/admin/status", method: "GET" });
    expect(requests.some(({ url }) => url === "/api/admin/errors")).toBe(false);
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);
    expect(document.body.textContent).toContain("Authenticated");
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
    expect(requests).toContainEqual({ url: "/api/admin/skip", method: "POST", body: JSON.stringify({ expectedPhaseId: "question-02" }) });

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

  it("keeps idle operations focused on session controls and scheduling", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    createAdminFetch({ status: { ...activeStatus, lifecycle: "idle" } });
    await renderApp();
    expect(document.querySelector("#admin-connection-heading")).toBeNull();
    expect(document.querySelector("#admin-flow-heading")).toBeNull();
    const headings = [...document.querySelectorAll(".admin-grid h2")].map((node) => node.textContent);
    expect(headings.slice(0, 2)).toEqual(["Session controls", "Run of show"]);
    expect(document.querySelector("#admin-lobby-heading")?.closest(".sc-tool-panel")).toBe(document.querySelector("#admin-controls-heading")?.closest(".sc-tool-panel"));
  });

  it("shows the published flow and confirms a direct jump to any other scene", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    const { requests } = createAdminFetch();
    await renderApp();

    expect(document.body.textContent).toContain("Scene navigator");
    expect(document.body.textContent).toContain("Opening film");
    expect(document.body.textContent).toContain("next → idle");
    const current = document.querySelector<HTMLButtonElement>('[aria-label="Inspect Choose a position"]')!;
    expect(current.disabled).toBe(false);
    expect(current.textContent).toContain("Choose a position");

    const opening = document.querySelector<HTMLButtonElement>('[aria-label="Inspect Opening film"]')!;
    await act(async () => { opening.click(); });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => { button("Jump whole show to this scene").click(); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Jump to “Opening film”?");
    await act(async () => { button("Jump to scene").click(); });
    await flush();

    expect(requests).toContainEqual({
      url: "/api/admin/jump",
      method: "POST",
      body: JSON.stringify({ phaseId: "intro", expectedPhaseId: "question-02", expectedEpoch: 7, sessionId: "5H7D-A2" }),
    });
    expect(document.body.textContent).toContain("Jumped to “Opening film”.");
  });

  it("adds a show start five minutes from now and keeps session controls first", async () => {
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
    expect(panels[0]?.querySelector("#admin-controls-heading")).not.toBeNull();
  });

  it("keeps server-refused actions visible as inline failure feedback", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    createAdminFetch({ rejectAction: "skip" });
    await renderApp();

    await act(async () => { button("Skip current phase").click(); });
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("server refused this action");
  });

  it("offers a single 'Start group paths' control while a group-branch phase is still assigning", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    const groupFlow = {
      entryPhaseId: "split",
      scenes: [{ id: "split", kind: "group-branch" as const, title: "Choose a role", routes: [{ outcome: "a", target: "vote" }, { outcome: "rejoin", target: "together" }] }],
    };
    const { requests } = createAdminFetch({
      flow: groupFlow,
      status: { ...activeStatus, phaseId: "split", groupPathsStarted: false, groupPaths: [] },
    });
    await renderApp();

    expect(document.body.textContent).not.toContain("Skip current phase");
    const startButton = button("Start group paths");
    expect(startButton.disabled).toBe(false);
    await act(async () => { startButton.click(); });
    await flush();
    expect(requests).toContainEqual({ url: "/api/admin/groups/start-paths", method: "POST", body: JSON.stringify({ expectedPhaseId: "split", expectedEpoch: 7 }) });
  });

  it("lets an operator advance one running group independently and force a reunion for the rest", async () => {
    localStorage.setItem("admin-token", "operator-secret");
    const groupFlow = {
      entryPhaseId: "split",
      scenes: [{ id: "split", kind: "group-branch" as const, title: "Choose a role", routes: [{ outcome: "a", target: "vote" }, { outcome: "rejoin", target: "together" }] }],
    };
    const { requests } = createAdminFetch({
      flow: groupFlow,
      status: {
        ...activeStatus,
        phaseId: "split",
        groupPathsStarted: true,
        groupPaths: [
          { groupId: "a", memberIds: ["p1", "p2"], phaseId: "vote", phaseEpoch: 3, done: false, label: "Actors", color: "#f00", phaseTitle: "Choose" },
          { groupId: "b", memberIds: ["p3"], phaseId: "together", phaseEpoch: 4, done: true, label: "Builders", color: "#0f0", phaseTitle: "Reunion" },
        ],
      },
    });
    await renderApp();

    expect(document.body.textContent).not.toContain("Skip current phase");
    expect(document.body.textContent).toContain("Builders — finished");

    const groupButton = button("Next scene for Actors — 2 people");
    await act(async () => { groupButton.click(); });
    await flush();
    expect(requests).toContainEqual({ url: "/api/admin/skip", method: "POST", body: JSON.stringify({ groupId: "a", expectedPhaseId: "vote" }) });

    const reunionTrigger = button("Bring all groups to reunion");
    await act(async () => { reunionTrigger.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Bring all groups to reunion?");
    await act(async () => { dialog.querySelector<HTMLButtonElement>('[data-sc-tool-variant="danger"]')?.click(); });
    await flush();
    expect(requests).toContainEqual({ url: "/api/admin/groups/reunion", method: "POST", body: JSON.stringify({ expectedPhaseId: "split", expectedEpoch: 7 }) });
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

    expect(document.body.textContent).toContain("Video playback");
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
      if (url.endsWith("/settings/display")) return jsonResponse({ configured: true, display: DEFAULT_DISPLAY_SETTINGS });
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
    expect(document.body.textContent).toContain("Last status received");
    expect(document.body.textContent).toContain("Showing the last received status");
    expect(document.body.textContent).toContain("question-02");

    failStatus = false;
    await act(async () => { poll(); });
    await flush();
    expect(document.body.textContent).toContain("Authenticated");
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

it("plays and stops background music while the show is active", async () => {
  localStorage.setItem("admin-token", "operator-token");
  const { mock, requests } = createAdminFetch({ status: { ...activeStatus, audio: {
    configured: true, players: [], soundcheckSources: ["music.mp3"], backgroundMusic: null,
  } } });
  // Real fetch() defaults a plain string body's Content-Type to text/plain,
  // which Fastify then leaves unparsed instead of JSON -- so every music
  // request must set this header explicitly. See #133.
  const musicContentType = () => {
    const calls = mock.mock.calls.filter(([input]) => String(input).endsWith("/audio/music"));
    return new Headers(calls.at(-1)?.[1]?.headers).get("content-type");
  };
  await renderApp();
  expect(button("Play / apply music").disabled).toBe(true);
  const select = document.querySelector('[aria-label="Background music"] select') as HTMLSelectElement;
  await act(async () => {
    select.value = "music.mp3";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(button("Play / apply music").disabled).toBe(false);
  await act(async () => button("Play / apply music").click());
  await flush();
  expect(JSON.parse(requests.find(r => r.url.endsWith("/audio/music"))!.body!)).toEqual({ src: "music.mp3", volume: 0.2 });
  expect(musicContentType()).toBe("application/json");
  await act(async () => button("Stop music").click());
  await flush();
  expect(JSON.parse(requests.filter(r => r.url.endsWith("/audio/music")).at(-1)!.body!)).toEqual({ src: null, volume: 0.2 });
  expect(musicContentType()).toBe("application/json");
});

it("offers scoped start and scoped reunion for nested splits", async () => {
  localStorage.setItem("admin-token", "operator-secret");
  const { requests } = createAdminFetch({
    flow: { entryPhaseId: "split", scenes: [{ id: "split", kind: "group-branch", title: "Split", routes: [] }] },
    status: { ...activeStatus, phaseId: "split", groupPathsStarted: true, groupPaths: [
      { groupId: "ki", label: "KI", color: null, memberIds: ["p1"], phaseId: "roles", phaseTitle: "Choose trade", phaseEpoch: 5, done: false, state: "choosing", pendingAssignments: 0 },
      { groupId: "other", label: "Other", color: null, memberIds: [], phaseId: "other-split", phaseTitle: "Other selection", phaseEpoch: 6, done: false, state: "split", acceptingParticipants: false },
    ] },
  });
  await renderApp();
  await act(async () => button("Start groups for KI").click()); await flush();
  expect(requests).toContainEqual({ url: "/api/admin/groups/start-paths", method: "POST", body: JSON.stringify({ groupId: "ki", expectedPhaseId: "roles", expectedEpoch: 5 }) });
  await act(async () => button("Finish subgroups of Other").click());
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain("Other groups continue");
  await act(async () => dialog.querySelector<HTMLButtonElement>('[data-sc-tool-variant="danger"]')!.click()); await flush();
  expect(requests).toContainEqual({ url: "/api/admin/groups/reunion", method: "POST", body: JSON.stringify({ groupId: "other", expectedPhaseId: "other-split", expectedEpoch: 6 }) });
});
