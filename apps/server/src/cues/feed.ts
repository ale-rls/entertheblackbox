import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type { ShowCueEvent } from "../engine/phase-engine.js";

type CueEnvelope = ShowCueEvent & { version: 1; bootId: string; sequence: number };

function credentialsMatch(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Authenticated, read-only SSE output for TouchDesigner and other show-control receivers. */
export class CueFeed {
  private readonly bootId = randomUUID();
  private sequence = 0;
  private readonly listeners = new Set<ServerResponse>();
  private readonly currentByTimeline = new Map<string, CueEnvelope>();

  publish(event: ShowCueEvent): CueEnvelope {
    const envelope = { version: 1 as const, bootId: this.bootId, sequence: ++this.sequence, ...event };
    if (event.type === "reset") this.currentByTimeline.clear();
    if (event.type === "phase") this.currentByTimeline.set(event.timelineId, envelope);
    if (event.type === "result") {
      const current = this.currentByTimeline.get(event.timelineId);
      this.currentByTimeline.set(event.timelineId, current === undefined
        ? envelope
        : { ...current, payload: { ...current.payload, result: event.payload } });
    }
    for (const listener of this.listeners) this.write(listener, envelope);
    return envelope;
  }

  snapshot(): Record<string, unknown> {
    return {
      version: 1,
      bootId: this.bootId,
      sequence: this.sequence,
      type: "snapshot",
      timestamp: Date.now(),
      timelines: [...this.currentByTimeline.values()],
    };
  }

  register(app: FastifyInstance, token: string): void {
    app.get("/api/cues", async (request, reply) => {
      if (!credentialsMatch(request.headers.authorization ?? "", `Bearer ${token}`)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (this.listeners.size >= 16) return reply.code(503).send({ error: "cue_listener_capacity" });

      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      this.listeners.add(response);
      this.write(response, this.snapshot());
      const keepalive = setInterval(() => {
        if (!response.write(": heartbeat\n\n")) response.destroy();
      }, 15_000);
      keepalive.unref();
      response.on("close", () => {
        clearInterval(keepalive);
        this.listeners.delete(response);
      });
    });
    app.addHook("preClose", async () => {
      for (const listener of this.listeners) listener.destroy();
      this.listeners.clear();
    });
  }

  private write(response: ServerResponse, event: unknown): void {
    if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) response.destroy();
  }
}
