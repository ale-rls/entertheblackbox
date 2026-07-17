import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const productionSecrets = {
  ADMIN_TOKEN: "production-admin-token",
  JOIN_GRANT_SECRET: "production-join-grant-secret",
  DISPLAY_TOKEN: "production-display-token",
} as const;

describe("production secret configuration", () => {
  it.each([
    ["ADMIN_TOKEN", "dev-admin-token-please-change"],
    ["JOIN_GRANT_SECRET", "dev-join-grant-secret-please-change"],
    ["DISPLAY_TOKEN", "dev-display-token"],
  ] as const)("rejects the development %s", (name, developmentDefault) => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      ...productionSecrets,
      [name]: developmentDefault,
    })).toThrow(new ConfigError(`invalid server configuration: ${name} must be set in production`));
  });

  it("keeps development and test defaults while accepting configured production secrets", () => {
    for (const nodeEnv of ["development", "test"] as const) {
      expect(loadConfig({ NODE_ENV: nodeEnv })).toMatchObject({
        adminToken: "dev-admin-token-please-change",
        joinGrantSecret: "dev-join-grant-secret-please-change",
        displayToken: "dev-display-token",
      });
    }
    expect(loadConfig({ NODE_ENV: "production", ...productionSecrets })).toMatchObject({
      adminToken: productionSecrets.ADMIN_TOKEN,
      joinGrantSecret: productionSecrets.JOIN_GRANT_SECRET,
      displayToken: productionSecrets.DISPLAY_TOKEN,
    });
  });
});
