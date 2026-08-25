import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { REPO_ROOT } from "./paths.js";

/**
 * A dedicated PocketBase instance for the e2e/Playwright run, separate from
 * a developer's local `pnpm pocketbase:dev` instance (different port and
 * data dir) so the two never collide. Started once in Playwright's global
 * setup and shared by every spawned server process (admin auth now goes
 * through PocketBase's `operators` collection instead of a static token).
 */
export const E2E_POCKETBASE_PORT = 8091;
export const E2E_POCKETBASE_URL = `http://127.0.0.1:${E2E_POCKETBASE_PORT}`;
export const E2E_POCKETBASE_ADMIN_EMAIL = "e2e-superuser@smartphonecracy.local";
export const E2E_POCKETBASE_ADMIN_PASSWORD = "e2e-superuser-password-12345";
export const E2E_OPERATOR_EMAIL = "e2e-operator@smartphonecracy.local";
export const E2E_OPERATOR_PASSWORD = "e2e-operator-password-12345";

const DATA_DIR = `${REPO_ROOT}/pocketbase/.e2e-data`;
const BIN = `${REPO_ROOT}/pocketbase/bin/pocketbase`;

let child: ChildProcess | null = null;

async function waitHealthy(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${E2E_POCKETBASE_URL}/api/health`);
      if (res.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error(`e2e PocketBase not healthy within ${timeoutMs}ms`);
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(BIN, args, { stdio: "pipe" });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

export async function startE2ePocketBase(): Promise<void> {
  await rm(DATA_DIR, { recursive: true, force: true });
  child = spawn(BIN, ["serve", `--http=127.0.0.1:${E2E_POCKETBASE_PORT}`, `--dir=${DATA_DIR}`], {
    stdio: "pipe",
  });
  await waitHealthy();
  await run(["superuser", "upsert", E2E_POCKETBASE_ADMIN_EMAIL, E2E_POCKETBASE_ADMIN_PASSWORD, `--dir=${DATA_DIR}`]);

  const auth = await fetch(`${E2E_POCKETBASE_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: E2E_POCKETBASE_ADMIN_EMAIL, password: E2E_POCKETBASE_ADMIN_PASSWORD }),
  }).then((res) => res.json()) as { token: string };

  await fetch(`${E2E_POCKETBASE_URL}/api/collections/operators/records`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: E2E_OPERATOR_EMAIL,
      password: E2E_OPERATOR_PASSWORD,
      passwordConfirm: E2E_OPERATOR_PASSWORD,
      role: "operator",
      emailVisibility: true,
      verified: true,
    }),
  });
}

export function stopE2ePocketBase(): void {
  child?.kill("SIGTERM");
  child = null;
}

let cachedOperatorToken: Promise<string> | null = null;

/** Cached across calls: e2e specs poll adminStatus() in tight loops. */
export function e2eOperatorToken(): Promise<string> {
  cachedOperatorToken ??= fetch(`${E2E_POCKETBASE_URL}/api/collections/operators/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: E2E_OPERATOR_EMAIL, password: E2E_OPERATOR_PASSWORD }),
  })
    .then((res) => res.json() as Promise<{ token: string }>)
    .then((body) => body.token);
  return cachedOperatorToken;
}
