import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const documentSchema = z.object({ title: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(200_000) }).strict();
const cueSchema = z.object({ revision: z.string(), cue: z.number().int().nonnegative() }).strict();
type Script = { title: string; paragraphs: string[]; cue: number; revision: string };

/** Private, ephemeral rehearsal state. Reader capabilities never authorize mutations. */
export function createScriptRoom() {
  let script: Script | null = null;
  let readerToken = randomBytes(32).toString("hex");
  const snapshot = () => ({ script, readerToken: script ? readerToken : null });
  return {
    registerReader(app: FastifyInstance) {
      app.get("/api/actor-script", async (request, reply) => {
        reply.header("cache-control", "no-store");
        if (request.headers.authorization !== `Bearer ${readerToken}` || !script) return reply.code(404).send({ error: "script_unavailable" });
        return { script };
      });
    },
    registerAdmin(admin: FastifyInstance) {
      admin.addHook("onSend", async (_request, reply, payload) => { reply.header("cache-control", "no-store"); return payload; });
      admin.get("/script", async () => snapshot());
      admin.put("/script", async (request, reply) => {
        const parsed = documentSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_script" });
        const paragraphs = parsed.data.text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        if (paragraphs.length > 2000) return reply.code(400).send({ error: "too_many_paragraphs" });
        script = { title: parsed.data.title, paragraphs, cue: 0, revision: randomBytes(16).toString("hex") };
        readerToken = randomBytes(32).toString("hex");
        return snapshot();
      });
      admin.patch("/script/cue", async (request, reply) => {
        const parsed = cueSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_cue" });
        if (!script || parsed.data.revision !== script.revision) return reply.code(409).send({ error: "script_changed" });
        if (parsed.data.cue >= script.paragraphs.length) return reply.code(400).send({ error: "invalid_cue" });
        script = { ...script, cue: parsed.data.cue };
        return snapshot();
      });
      admin.post("/script/rotate-link", async () => { readerToken = randomBytes(32).toString("hex"); return snapshot(); });
      admin.delete("/script", async () => { script = null; readerToken = randomBytes(32).toString("hex"); return snapshot(); });
    },
  };
}
