import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "@entertheblackbox/protocol";
import { buildServer, type ServerRuntime } from "../server.js";
import { loadConfig } from "../config.js";
import type { Scenario } from "@entertheblackbox/scenario";

const scenario: Scenario = { version: "preview-test", cyclesAllowed: false, entryPhaseId: "first", phases: [
  { kind: "idle", id: "idle" },
  { kind: "narration", id: "first", text: "First", durationMs: 60000, next: "second", outgoingCues: ["first-cue"] },
  { kind: "narration", id: "second", text: "Second", durationMs: 60000, next: "idle", outgoingCues: ["second-cue"] },
] };
const manifest = { files: [] };
const runtimes: ServerRuntime[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.app.close()));
});
async function fixture() {
  const runtime = await buildServer({ config: loadConfig({ NODE_ENV: "test" }),
    readiness: { ready: true, scenario, mediaManifest: manifest, warnings: [], showId: "production" },
    verifyOperatorToken: async (token) => token === "operator",
  });
  runtimes.push(runtime);
  await runtime.app.ready();
  return runtime;
}
function apply(runtime: ServerRuntime, id: string, phaseId = "first", content: unknown = scenario, token = "operator") {
  return runtime.app.inject({ method: "PUT", url: `/api/admin/rehearsals/${id}`, headers: { authorization: `Bearer ${token}` },
    payload: { phaseId, scenario: content, mediaManifest: manifest } });
}
async function device(url: string) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  const messages: any[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return { socket, messages };
}
async function until(condition: () => boolean) {
  const end = Date.now() + 3000;
  while (!condition()) { if (Date.now() > end) throw new Error("Timed out waiting for device message"); await new Promise((resolve) => setTimeout(resolve, 10)); }
}

describe("Studio device rehearsal", () => {
  it("requires operator auth and validates drafts before changing either runtime", async () => {
    const runtime = await fixture(); const id = randomUUID();
    expect((await apply(runtime, id, "first", scenario, "wrong")).statusCode).toBe(401);
    expect((await apply(runtime, id)).statusCode).toBe(200);
    const engine = runtime.rehearsals.get(id)!.engine;
    expect((await apply(runtime, id, "missing")).statusCode).toBe(400);
    expect((await apply(runtime, id, "first", { ...scenario, phases: [] })).statusCode).toBe(400);
    expect(runtime.rehearsals.get(id)!.engine).toBe(engine);
    expect(runtime.engine!.currentPhaseId).toBe("idle");
    expect(runtime.admission.registry.connectedCount).toBe(0);
  });

  it("keeps real phone/display sockets and identities across edited drafts, emits cues, and advances normally", async () => {
    const runtime = await fixture(); const id = randomUUID();
    await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const address = runtime.app.server.address() as { port: number };
    expect((await apply(runtime, id)).statusCode).toBe(200);
    const rehearsal = runtime.rehearsals.get(id)!;
    const phone = await device(`ws://127.0.0.1:${address.port}/ws?rehearsal=${id}`);
    phone.socket.send(JSON.stringify({ t: "join", v: PROTOCOL_VERSION, clientVersion: "dev", installationId: rehearsal.installationId, roomId: runtime.config.roomId, name: "Tester" }));
    await until(() => phone.messages.some((m) => m.t === "identity"));
    const identity = phone.messages.find((m) => m.t === "identity");
    const display = await device(`ws://127.0.0.1:${address.port}/ws?rehearsal=${id}`);
    display.socket.send(JSON.stringify({ t: "display_join", v: PROTOCOL_VERSION, clientVersion: "dev", installationId: rehearsal.installationId, roomId: runtime.config.roomId, displayToken: id }));
    await until(() => display.messages.some((m) => m.t === "snapshot" && m.phase.id === "first"));
    const stream = await fetch(`http://127.0.0.1:${address.port}/api/rehearsals/${id}/cues`, { headers: { Authorization: `Bearer ${id}` } });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain('"type":"snapshot"');
    const edited = { ...scenario, phases: scenario.phases.map((p) => p.id === "second" ? { ...p, text: "Latest draft" } : p) };
    expect((await apply(runtime, id, "second", edited)).statusCode).toBe(200);
    await until(() => phone.messages.some((m) => m.t === "snapshot" && m.phase.text === "Latest draft") && display.messages.some((m) => m.t === "snapshot" && m.phase.text === "Latest draft"));
    const cues = new TextDecoder().decode((await reader.read()).value);
    expect(cues).toContain('"cue":"second-cue"');
    expect(phone.socket.readyState).toBe(WebSocket.OPEN);
    expect(display.socket.readyState).toBe(WebSocket.OPEN);
    expect(phone.messages.filter((m) => m.t === "identity")).toEqual([identity]);
    expect(rehearsal.status()).toMatchObject({ participants: 1, displays: 1, phaseId: "second", revision: 2 });
    expect(runtime.engine!.currentPhaseId).toBe("idle");
    rehearsal.engine.tick(Date.now() + 60001);
    expect(rehearsal.engine.currentPhaseId).toBe("idle");
    expect(phone.socket.readyState).toBe(WebSocket.OPEN);
    await reader.cancel();
    await runtime.app.inject({ method: "DELETE", url: `/api/admin/rehearsals/${id}`, headers: { authorization: "Bearer operator" } });
    expect((await runtime.app.inject(`/api/rehearsals/${id}/status`)).statusCode).toBe(404);
  });

  it("isolates simultaneous drafts and rejects missing media without replacing the session", async () => {
    const runtime = await fixture(); const a = randomUUID(), b = randomUUID();
    await apply(runtime, a); await apply(runtime, b, "second");
    expect(runtime.rehearsals.get(a)!.engine.currentPhaseId).toBe("first");
    expect(runtime.rehearsals.get(b)!.engine.currentPhaseId).toBe("second");
    const response = await runtime.app.inject({ method: "PUT", url: `/api/admin/rehearsals/${a}`, headers: { authorization: "Bearer operator" }, payload: {
      phaseId: "first", scenario, mediaManifest: { files: [{ src: "missing.mp4", bytes: 10, hash: "missing" }] },
    } });
    expect(response.statusCode).toBe(400);
    expect(runtime.rehearsals.get(a)!.revision).toBe(1);
    expect((await runtime.app.inject(`/api/rehearsals/${a}/cues`)).statusCode).toBe(401);
  });
});
