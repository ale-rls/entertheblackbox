import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const DEVELOPMENT_DISPLAY_TOKEN = "dev-display-token";
const DEVELOPMENT_JOIN_GRANT_SECRET = "dev-join-grant-secret-please-change";
const DEVELOPMENT_POCKETBASE_ADMIN_PASSWORD = "dev-pocketbase-password";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  BUILD_VERSION: z.string().min(1).default("dev"),
  INSTALLATION_ID: z.string().min(1).default("dev-installation"),
  ROOM_ID: z.string().min(1).default("main"),
  SHOW_ID: z.string().min(1).default("local-dev"),
  DISPLAY_TOKEN: z.string().min(1).default(DEVELOPMENT_DISPLAY_TOKEN),
  ADMIN_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(600),
  ADMIN_RATE_LIMIT_MAX_AUTH_FAILURES: z.coerce.number().int().positive().default(30),
  ADMIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  MAX_PARTICIPANTS: z.coerce.number().int().positive().default(30),
  MAX_WEBSOCKET_CONNECTIONS: z.coerce.number().int().positive().default(300),
  JOIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(30),
  JOIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  JOIN_GRANT_SECRET: z.string().min(16).default(DEVELOPMENT_JOIN_GRANT_SECRET),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  ALLOW_LATE_JOIN: z.enum(["true", "false"]).default("true"),
  PHONE_JOIN_BASE_URL: z.string().url().default("http://localhost:5174/"),
  SHOW_PHONE_JOIN_BASE_URL: z.enum(["true", "false"]).default("true"),
  SCENARIO_PATH: z.string().min(1).optional(),
  MEDIA_MANIFEST_PATH: z.string().min(1).optional(),
  MEDIA_DIR: z.string().min(1).optional(),
  DISPLAY_DIST_DIR: z.string().min(1).optional(),
  PHONE_DIST_DIR: z.string().min(1).optional(),
  ADMIN_DIST_DIR: z.string().min(1).optional(),
  STUDIO_DIST_DIR: z.string().min(1).optional(),
  POCKETBASE_URL: z.string().url().default("http://127.0.0.1:8090"),
  POCKETBASE_ADMIN_EMAIL: z.string().email().default("dev@smartphonecracy.local"),
  POCKETBASE_ADMIN_PASSWORD: z.string().min(8).default(DEVELOPMENT_POCKETBASE_ADMIN_PASSWORD),
});

export type ServerConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  buildVersion: string;
  installationId: string;
  roomId: string;
  showId: string;
  displayToken: string;
  adminRateLimit: {
    maxAuthenticatedRequests: number;
    maxAuthenticationFailures: number;
    windowMs: number;
  };
  maxParticipants: number;
  maxWebSocketConnections: number;
  joinRateLimit: {
    maxAttempts: number;
    windowMs: number;
  };
  joinGrantSecret: string;
  trustProxy: boolean;
  allowLateJoin: boolean;
  phoneJoinBaseUrl: string;
  showPhoneJoinBaseUrl: boolean;
  scenarioPath: string;
  mediaManifestPath: string;
  mediaDir: string;
  bundleDirs: Record<"display" | "phone" | "admin" | "studio", string>;
  pocketbase: {
    url: string;
    adminEmail: string;
    adminPassword: string;
  };
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Parse environment input once and resolve every file path from the repo root. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  rootDir = repoRoot,
): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`invalid server configuration: ${details}`);
  }

  const value = parsed.data;
  if (value.NODE_ENV === "production") {
    const defaultSecret = [
      ["JOIN_GRANT_SECRET", value.JOIN_GRANT_SECRET, DEVELOPMENT_JOIN_GRANT_SECRET],
      ["DISPLAY_TOKEN", value.DISPLAY_TOKEN, DEVELOPMENT_DISPLAY_TOKEN],
      ["POCKETBASE_ADMIN_PASSWORD", value.POCKETBASE_ADMIN_PASSWORD, DEVELOPMENT_POCKETBASE_ADMIN_PASSWORD],
    ].find(([, configured, developmentDefault]) => configured === developmentDefault);
    if (defaultSecret !== undefined) {
      throw new ConfigError(`invalid server configuration: ${defaultSecret[0]} must be set in production`);
    }
  }
  const fromRoot = (path: string | undefined, fallback: string) =>
    resolve(rootDir, path ?? fallback);

  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    buildVersion: value.BUILD_VERSION,
    installationId: value.INSTALLATION_ID,
    roomId: value.ROOM_ID,
    showId: value.SHOW_ID,
    displayToken: value.DISPLAY_TOKEN,
    adminRateLimit: {
      maxAuthenticatedRequests: value.ADMIN_RATE_LIMIT_MAX_REQUESTS,
      maxAuthenticationFailures: value.ADMIN_RATE_LIMIT_MAX_AUTH_FAILURES,
      windowMs: value.ADMIN_RATE_LIMIT_WINDOW_MS,
    },
    maxParticipants: value.MAX_PARTICIPANTS,
    maxWebSocketConnections: value.MAX_WEBSOCKET_CONNECTIONS,
    joinRateLimit: {
      maxAttempts: value.JOIN_RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: value.JOIN_RATE_LIMIT_WINDOW_MS,
    },
    joinGrantSecret: value.JOIN_GRANT_SECRET,
    trustProxy: value.TRUST_PROXY === "true",
    allowLateJoin: value.ALLOW_LATE_JOIN === "true",
    phoneJoinBaseUrl: value.PHONE_JOIN_BASE_URL,
    showPhoneJoinBaseUrl: value.SHOW_PHONE_JOIN_BASE_URL === "true",
    scenarioPath: fromRoot(value.SCENARIO_PATH, "content/scenarios/dev.json"),
    mediaManifestPath: fromRoot(value.MEDIA_MANIFEST_PATH, "content/media-manifest.json"),
    mediaDir: fromRoot(value.MEDIA_DIR, "content/media"),
    bundleDirs: {
      display: fromRoot(value.DISPLAY_DIST_DIR, "apps/display/dist"),
      phone: fromRoot(value.PHONE_DIST_DIR, "apps/phone/dist"),
      admin: fromRoot(value.ADMIN_DIST_DIR, "apps/admin/dist"),
      studio: fromRoot(value.STUDIO_DIST_DIR, "apps/studio/dist"),
    },
    pocketbase: {
      url: value.POCKETBASE_URL,
      adminEmail: value.POCKETBASE_ADMIN_EMAIL,
      adminPassword: value.POCKETBASE_ADMIN_PASSWORD,
    },
  };
}
