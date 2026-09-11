import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { CueFeed } from "./feed.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("CueFeed", () => {
  it("keeps a reconnectable snapshot for each independent timeline", () => {
    const feed = new CueFeed();
    feed.publish({ type: "phase", timelineId: "a", sessionId: "visit", phaseId: "q-a", phaseEpoch: 3, timestamp: 10, payload: { phase: { kind: "position-question" } } });
    feed.publish({ type: "phase", timelineId: "b", sessionId: "visit", phaseId: "film-b", phaseEpoch: 4, timestamp: 11, payload: { phase: { kind: "video" } } });
    feed.publish({ type: "result", timelineId: "a", sessionId: "visit", phaseId: "q-a", phaseEpoch: 3, timestamp: 12, payload: { winner: "max" } });

    expect(feed.snapshot()).toMatchObject({
      version: 1,
      sequence: 3,
      type: "snapshot",
      timelines: [
        { timelineId: "a", phaseId: "q-a", payload: { phase: { kind: "position-question" }, result: { winner: "max" } } },
        { timelineId: "b", phaseId: "film-b", payload: { phase: { kind: "video" } } },
      ],
    });
    feed.publish({ type: "reset", timelineId: "main", sessionId: "visit", phaseId: "together", phaseEpoch: 5, timestamp: 13, payload: {} });
    expect(feed.snapshot()).toMatchObject({ sequence: 4, timelines: [] });
  });

  it("requires the display token", async () => {
    const app = Fastify();
    apps.push(app);
    new CueFeed().register(app, "secret");
    expect((await app.inject({ url: "/api/cues" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/cues", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
  });
});
