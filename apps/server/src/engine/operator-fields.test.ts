import { describe, expect, it } from "vitest";
import { scenarioSchema } from "@entertheblackbox/scenario";
import { parseServerMessage, type ClientToServerMessage } from "@entertheblackbox/protocol";
import type { WebSocket } from "ws";
import { ParticipantRegistry } from "../admission/registry.js";
import { PhaseEngine } from "./phase-engine.js";

class Socket {
  readyState = 1;
  sent: any[] = [];
  send(raw: string) { expect(parseServerMessage(raw).ok).toBe(true); this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  terminate() { this.close(); }
  get ws() { return this as unknown as WebSocket; }
  get snapshot() { return this.sent.filter((m) => m.t === "phase" || m.t === "snapshot").at(-1); }
}

const zone = (id: string, x: number, y: number, color: string) => ({ id, label: id.toUpperCase(), color, points: [{ x, y }, { x: x + 0.47, y }, { x: x + 0.47, y: y + 0.47 }, { x, y: y + 0.47 }] });
const scenario = scenarioSchema.parse({
  version: "operator-fields", entryPhaseId: "hack",
  phases: [
    { kind: "idle", id: "idle" },
    { kind: "video", id: "hack", src: "still.png", audioSrc: "silence.mp3", expectedDurationMs: 60_000, next: "after",
      operatorFields: { zones: [zone("rot", 0, 0, "#e5484d"), zone("blau", 0.53, 0, "#3e63dd"), zone("gelb", 0, 0.53, "#f5d90a"), zone("gruen", 0.53, 0.53, "#30a46c")], total: 12 } },
    { kind: "narration", id: "after", text: "After", durationMs: 1_000, next: "idle" },
  ],
});

function setup() {
  let now = 0;
  const engine = new PhaseEngine({
    scenario, registry: new ParticipantRegistry(10), now: () => now,
    installationId: "inst", roomId: "room", showId: "show", displayToken: "secret",
    autoStartOnFirstParticipant: false, sessionIdFactory: () => "visit",
  });
  const display = new Socket();
  engine.handleClientMessage({ t: "display_join", v: 2, clientVersion: "test", installationId: "inst", roomId: "room", displayToken: "secret" } as ClientToServerMessage, display.ws);
  return { engine, display, tick: (time: number) => { now = time; engine.tick(now); } };
}

describe("operator fields", () => {
  it("lights one field and steps the counter, sending each change to the display", () => {
    const h = setup(); h.engine.adminStart(); h.tick(100);
    expect(h.display.snapshot.phase).toMatchObject({ id: "hack", operatorField: { target: null, count: 0 } });
    expect(h.engine.adminOperatorField({ target: "blau" }, "hack")).toEqual({ ok: true });
    expect(h.display.snapshot.phase.operatorField).toEqual({ target: "blau", count: 0 });
    h.engine.adminOperatorField({ countDelta: 1 });
    h.engine.adminOperatorField({ target: "gelb", countDelta: 1 });
    expect(h.display.snapshot.phase.operatorField).toEqual({ target: "gelb", count: 2 });
    h.engine.adminOperatorField({ countDelta: 50 });
    expect(h.engine.operatorFieldState.count).toBe(12);
    h.engine.adminOperatorField({ countDelta: -20, target: null });
    expect(h.engine.operatorFieldState).toEqual({ target: null, count: 0 });
    h.engine.stop();
  });

  it("rejects unknown fields, stale scenes and scenes without operator fields; the next scene starts fresh", () => {
    const h = setup(); h.engine.adminStart(); h.tick(100);
    expect(h.engine.adminOperatorField({ target: "lila" })).toEqual({ ok: false, reason: "invalid-target" });
    expect(h.engine.adminOperatorField({ target: "rot" }, "after")).toEqual({ ok: false, reason: "stale" });
    h.engine.adminOperatorField({ target: "rot", countDelta: 3 });
    h.engine.adminSkip();
    expect(h.engine.adminOperatorField({ target: "rot" })).toEqual({ ok: false, reason: "wrong-phase" });
    expect(h.display.snapshot.phase.operatorField).toBeUndefined();
    h.engine.stop();
  });
});
