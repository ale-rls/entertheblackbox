import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  E2E_POCKETBASE_ADMIN_EMAIL,
  E2E_POCKETBASE_ADMIN_PASSWORD,
  E2E_POCKETBASE_URL,
  e2eOperatorToken,
} from "./pocketbase.js";
import { REPO_ROOT } from "./paths.js";

export { REPO_ROOT };
export const INSTALLATION_ID = "dev-installation";
export const ROOM_ID = "main";
export const DISPLAY_TOKEN = "dev-display-token";
export const JOIN_GRANT_SECRET = "dev-join-grant-secret-please-change";

const E2E_SCENARIO = "tests/e2e/fixtures/scenario.json";

let nextPort = 4310 + (process.pid % 400);

export type E2eServer = {
  readonly port: number;
  readonly baseUrl: string;
  /** SIGKILL — simulates a crash; the port stays reserved for restart(). */
  kill(): void;
  /** Graceful SIGTERM + wait for exit. */
  stop(): Promise<void>;
  /** Start a fresh process on the same port (after kill/stop). */
  restart(extraEnv?: Record<string, string>): Promise<void>;
};

async function waitReady(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/readyz`);
      if (res.status === 200) return;
      lastError = `readyz ${res.status}: ${await res.text()}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await sleep(250);
  }
  throw new Error(`server at ${baseUrl} not ready within ${timeoutMs}ms: ${lastError}`);
}

function launch(port: number, env: Record<string, string>): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/index.ts"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        SCENARIO_PATH: E2E_SCENARIO,
        // Must match the vite __BUILD_VERSION__ fallback baked into the
        // bundles under test, or every join triggers the STEP-031 reload
        // path. The stale-bundle spec overrides this deliberately.
        BUILD_VERSION: "0.0.0-dev",
        POCKETBASE_URL: E2E_POCKETBASE_URL,
        POCKETBASE_ADMIN_EMAIL: E2E_POCKETBASE_ADMIN_EMAIL,
        POCKETBASE_ADMIN_PASSWORD: E2E_POCKETBASE_ADMIN_PASSWORD,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Surface server output on failure without spamming the reporter.
  const buffer: string[] = [];
  const capture = (chunk: Buffer) => {
    buffer.push(chunk.toString());
    if (buffer.length > 200) buffer.shift();
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0 && signal === null) {
      console.error(`[e2e server :${port}] exited ${code}\n${buffer.slice(-40).join("")}`);
    }
  });
  return child;
}

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
}

export async function startServer(env: Record<string, string> = {}): Promise<E2eServer> {
  const port = nextPort;
  nextPort += 1;
  const baseUrl = `http://127.0.0.1:${port}`;
  let child = launch(port, env);
  let currentEnv = env;
  try {
    await waitReady(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    await waitExit(child);
    throw error;
  }

  return {
    port,
    baseUrl,
    kill() {
      child.kill("SIGKILL");
    },
    async stop() {
      child.kill("SIGTERM");
      await waitExit(child);
    },
    async restart(extraEnv: Record<string, string> = {}) {
      child.kill("SIGKILL");
      await waitExit(child);
      currentEnv = { ...currentEnv, ...extraEnv };
      child = launch(port, currentEnv);
      await waitReady(baseUrl);
    },
  };
}

export async function adminStatus(baseUrl: string): Promise<{
  lifecycle: string | null;
  phaseId: string | null;
  sessionId: string | null;
  displayConnected: boolean;
  connectedParticipants: number;
}> {
  const token = await e2eOperatorToken();
  const res = await fetch(`${baseUrl}/api/admin/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) throw new Error(`admin status ${res.status}`);
  return (await res.json()) as ReturnType<typeof adminStatus> extends Promise<infer T> ? T : never;
}

export async function adminAction(baseUrl: string, action: "start" | "idle" | "skip" | "restart"): Promise<void> {
  const token = await e2eOperatorToken();
  const response = await fetch(`${baseUrl}/api/admin/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`admin ${action} ${response.status}: ${await response.text()}`);
}
