import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const productionSecrets = {
  JOIN_GRANT_SECRET: "production-join-grant-secret",
  DISPLAY_TOKEN: "production-display-token",
  POCKETBASE_ADMIN_PASSWORD: "production-pocketbase-password",
  PHONE_JOIN_BASE_URL: "https://play.example/phone/",
} as const;

describe("production secret configuration", () => {
  it.each([
    ["JOIN_GRANT_SECRET", "dev-join-grant-secret-please-change"],
    ["DISPLAY_TOKEN", "dev-display-token"],
    ["POCKETBASE_ADMIN_PASSWORD", "dev-pocketbase-password"],
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
        joinGrantSecret: "dev-join-grant-secret-please-change",
        displayToken: "dev-display-token",
        allowLateJoin: true,
        showPhoneJoinBaseUrl: true,
      });
    }
    expect(loadConfig({ NODE_ENV: "production", ...productionSecrets })).toMatchObject({
      joinGrantSecret: productionSecrets.JOIN_GRANT_SECRET,
      displayToken: productionSecrets.DISPLAY_TOKEN,
    });
  });

  it("allows late joining and the printed lobby URL to be disabled explicitly", () => {
    expect(loadConfig({
      ALLOW_LATE_JOIN: "false",
      SHOW_PHONE_JOIN_BASE_URL: "false",
    })).toMatchObject({ allowLateJoin: false, showPhoneJoinBaseUrl: false });
  });

  it("treats an empty optional TrackingBox URL from Compose as disabled", () => {
    expect(loadConfig({ TRACKINGBOX_URL: "" }).trackingBoxUrl).toBeNull();
  });

  it("ignores retired stream configuration for native-only participants", () => {
    const config = loadConfig({ AUDIO_BRIDGE_URL: "not-a-url", AUDIO_BRIDGE_TOKEN: "old",
      AUDIO_PUBLIC_URL: "", REQUIRE_PHONE_AUDIO: "true", JANUS_ENABLED: "true",
      JANUS_BRIDGE_URL: "bad", JANUS_BRIDGE_TOKEN: "old", JANUS_PUBLIC_URL: "bad", JANUS_ICE_SERVERS: "bad" });
    expect(config.audio).toBeUndefined();
    expect(config.janusAudio).toBeUndefined();
  });

  it("requires the production phone join URL to be public HTTPS with the phone path", () => {
    for (const url of ["http://play.example/phone/", "https://play.example/", "https://play.example/phone"]) {
      expect(() => loadConfig({
        NODE_ENV: "production",
        ...productionSecrets,
        PHONE_JOIN_BASE_URL: url,
      })).toThrow(new ConfigError("PHONE_JOIN_BASE_URL must use HTTPS and end in /phone/ or /phone-janus/ in production"));
    }
  });
});
