import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const DEVELOPMENT_DISPLAY_TOKEN = "dev-display-token";
const DEVELOPMENT_ADMIN_TOKEN = "dev-admin-token-please-change";
const DEVELOPMENT_JOIN_GRANT_SECRET = "dev-join-grant-secret-please-change";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  BUILD_VERSION: z.string().min(1).default("dev"),
  DATABASE_URL: z.string().min(1).optional(),
  INSTALLATION_CLOSES_AT: z.string().datetime({ offset: true }).optional(),
  PERSISTENCE_FLUSH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  INSTALLATION_ID: z.string().min(1).default("dev-installation"),
  ROOM_ID: z.string().min(1).default("main"),
  DISPLAY_TOKEN: z.string().min(1).default(DEVELOPMENT_DISPLAY_TOKEN),
  ADMIN_TOKEN: z.string().min(16).default(DEVELOPMENT_ADMIN_TOKEN),
  ADMIN_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(600),
  ADMIN_RATE_LIMIT_MAX_AUTH_FAILURES: z.coerce.number().int().positive().default(30),
  ADMIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  JOIN_GRANT_SECRET: z.string().min(16).default(DEVELOPMENT_JOIN_GRANT_SECRET),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  ALLOW_LATE_JOIN: z.enum(["true", "false"]).default("false"),
  PHONE_JOIN_BASE_URL: z.string().url().default("http://localhost:5174/"),
  SCENARIO_PATH: z.string().min(1).optional(),
  MEDIA_MANIFEST_PATH: z.string().min(1).optional(),
  MEDIA_DIR: z.string().min(1).optional(),
  DISPLAY_DIST_DIR: z.string().min(1).optional(),
  PHONE_DIST_DIR: z.string().min(1).optional(),
  ADMIN_DIST_DIR: z.string().min(1).optional(),
});

export type ServerConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  buildVersion: string;
  databaseUrl?: string;
  participantDataExpiresAt?: number;
  persistenceFlushTimeoutMs: number;
  installationId: string;
  roomId: string;
  displayToken: string;
  adminToken: string;
  adminRateLimit: {
    maxAuthenticatedRequests: number;
    maxAuthenticationFailures: number;
    windowMs: number;
  };
  joinGrantSecret: string;
  trustProxy: boolean;
  allowLateJoin: boolean;
  phoneJoinBaseUrl: string;
  scenarioPath: string;
  mediaManifestPath: string;
  mediaDir: string;
  bundleDirs: Record<"display" | "phone" | "admin", string>;
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
      ["ADMIN_TOKEN", value.ADMIN_TOKEN, DEVELOPMENT_ADMIN_TOKEN],
      ["JOIN_GRANT_SECRET", value.JOIN_GRANT_SECRET, DEVELOPMENT_JOIN_GRANT_SECRET],
      ["DISPLAY_TOKEN", value.DISPLAY_TOKEN, DEVELOPMENT_DISPLAY_TOKEN],
    ].find(([, configured, developmentDefault]) => configured === developmentDefault);
    if (defaultSecret !== undefined) {
      throw new ConfigError(`invalid server configuration: ${defaultSecret[0]} must be set in production`);
    }
  }
  if (value.DATABASE_URL !== undefined && value.INSTALLATION_CLOSES_AT === undefined) {
    throw new ConfigError("invalid server configuration: INSTALLATION_CLOSES_AT is required when DATABASE_URL is set");
  }
  const fromRoot = (path: string | undefined, fallback: string) =>
    resolve(rootDir, path ?? fallback);

  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    buildVersion: value.BUILD_VERSION,
    ...(value.DATABASE_URL === undefined ? {} : {
      databaseUrl: value.DATABASE_URL,
      participantDataExpiresAt: Date.parse(value.INSTALLATION_CLOSES_AT!) + 90 * 86_400_000,
    }),
    persistenceFlushTimeoutMs: value.PERSISTENCE_FLUSH_TIMEOUT_MS,
    installationId: value.INSTALLATION_ID,
    roomId: value.ROOM_ID,
    displayToken: value.DISPLAY_TOKEN,
    adminToken: value.ADMIN_TOKEN,
    adminRateLimit: {
      maxAuthenticatedRequests: value.ADMIN_RATE_LIMIT_MAX_REQUESTS,
      maxAuthenticationFailures: value.ADMIN_RATE_LIMIT_MAX_AUTH_FAILURES,
      windowMs: value.ADMIN_RATE_LIMIT_WINDOW_MS,
    },
    joinGrantSecret: value.JOIN_GRANT_SECRET,
    trustProxy: value.TRUST_PROXY === "true",
    allowLateJoin: value.ALLOW_LATE_JOIN === "true",
    phoneJoinBaseUrl: value.PHONE_JOIN_BASE_URL,
    scenarioPath: fromRoot(value.SCENARIO_PATH, "content/scenarios/dev.json"),
    mediaManifestPath: fromRoot(value.MEDIA_MANIFEST_PATH, "content/media-manifest.json"),
    mediaDir: fromRoot(value.MEDIA_DIR, "content/media"),
    bundleDirs: {
      display: fromRoot(value.DISPLAY_DIST_DIR, "apps/display/dist"),
      phone: fromRoot(value.PHONE_DIST_DIR, "apps/phone/dist"),
      admin: fromRoot(value.ADMIN_DIST_DIR, "apps/admin/dist"),
    },
  };
}
