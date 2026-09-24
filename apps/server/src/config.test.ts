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

  it("keeps Janus disabled when optional Compose settings are empty", () => {
    expect(loadConfig({ JANUS_BRIDGE_URL: "", JANUS_BRIDGE_TOKEN: "", JANUS_PUBLIC_URL: "", JANUS_ICE_SERVERS: "[]" }).janusAudio).toBeUndefined();
    expect(() => loadConfig({ JANUS_BRIDGE_URL: "https://control.example", JANUS_BRIDGE_TOKEN: "", JANUS_PUBLIC_URL: "https://janus.example" })).toThrow(ConfigError);
  });

  it("requires a token and phone-reachable public URL with the audio bridge", () => {
    expect(() => loadConfig({ AUDIO_BRIDGE_URL: "http://bridge:8090" })).toThrow(ConfigError);
    expect(() => loadConfig({ AUDIO_BRIDGE_TOKEN: "secret" })).toThrow(ConfigError);
    expect(() => loadConfig({ AUDIO_PUBLIC_URL: "https://audio.example" })).toThrow(ConfigError);
    expect(() => loadConfig({ REQUIRE_PHONE_AUDIO: "true" })).toThrow(ConfigError);
    expect(loadConfig({
      AUDIO_BRIDGE_URL: "http://bridge:8090",
      AUDIO_BRIDGE_TOKEN: "secret",
      AUDIO_PUBLIC_URL: "https://audio.example",
      REQUIRE_PHONE_AUDIO: "true",
    }).audio).toEqual({ url: "http://bridge:8090", token: "secret", publicUrl: "https://audio.example" });
  });

  it("requires HTTPS for the public phone stream in production", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      ...productionSecrets,
      AUDIO_BRIDGE_URL: "http://bridge:8090",
      AUDIO_BRIDGE_TOKEN: "secret",
      AUDIO_PUBLIC_URL: "http://audio.example",
    })).toThrow(new ConfigError("AUDIO_PUBLIC_URL must use HTTPS in production"));
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


describe("explicit Janus shutdown", () => {
  it("ignores stale partial and invalid Janus settings while keeping Icecast", () => {
    const env = {
      JANUS_ENABLED: "false", JANUS_BRIDGE_TOKEN: "old", JANUS_PUBLIC_URL: "not-a-url",
      JANUS_ICE_SERVERS: "invalid-json", AUDIO_BRIDGE_URL: "http://bridge:8090",
      AUDIO_BRIDGE_TOKEN: "icecast-secret", AUDIO_PUBLIC_URL: "https://audio.example",
      REQUIRE_PHONE_AUDIO: "true",
    };
    const config = loadConfig(env);
    expect(config.janusAudio).toBeUndefined();
    expect(config.audio?.url).toBe("http://bridge:8090");
    expect(env.JANUS_BRIDGE_TOKEN).toBe("old");
  });
  it("still rejects partial settings when Janus is enabled", () => {
    expect(() => loadConfig({ JANUS_ENABLED: "true", JANUS_BRIDGE_URL: "http://janus-bridge:8090" })).toThrow(ConfigError);
    expect(() => loadConfig({ JANUS_ENABLED: "flase" })).toThrow(ConfigError);
  });
  it("does not count disabled Janus as required phone audio", () => {
    expect(() => loadConfig({ JANUS_ENABLED: "false", REQUIRE_PHONE_AUDIO: "true",
      JANUS_BRIDGE_URL: "http://janus-bridge:8090", JANUS_BRIDGE_TOKEN: "a".repeat(32),
      JANUS_PUBLIC_URL: "https://janus.example" })).toThrow(ConfigError);
  });
});
