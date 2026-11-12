import { createHash, createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACTOR_SCRIPT_MAX_PARAGRAPHS, scriptParagraphs, type ActorScript } from "@entertheblackbox/scenario";

const documentSchema = z.object({ title: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(200_000) }).strict();
const cueSchema = z.object({ revision: z.string(), cue: z.number().int().nonnegative() }).strict();
type Document = { title: string; paragraphs: string[]; revision: string };
type Script = Document & { cue: number; source: "show" | "admin" };

/** The latest authored script cue fired on the main timeline; `key` changes each time a new cue fires. */
export type ScriptTimelineCue = { key: string; paragraph: number };

export type ShowScriptOptions = {
  script: ActorScript | undefined;
  scenarioVersion: string;
  /** Server secret; the default reader link is derived from it so it survives restarts. */
  linkSecret: string;
  timeline: () => ScriptTimelineCue | null;
};

const randomToken = () => randomBytes(32).toString("hex");

/**
 * Shared actor script. The published show's script loads automatically and its
 * scenes move the cue; an Admin-loaded script overrides it until cleared.
 * Reader capabilities never authorize mutations.
 */
export function createScriptRoom(show?: ShowScriptOptions) {
  const showScript: Document | null = show?.script ? {
    title: show.script.title,
    paragraphs: scriptParagraphs(show.script.text),
    revision: createHash("sha256").update(`${show.scenarioVersion}\0${show.script.title}\0${show.script.text}`).digest("hex").slice(0, 32),
  } : null;
  let adminScript: Document | null = null;
  let cue = 0;
  let appliedKey: string | null = null;
  let readerToken = show ? createHmac("sha256", show.linkSecret).update(`actor-script:${show.scenarioVersion}`).digest("hex") : randomToken();

  const current = (): Script | null => {
    if (adminScript) return { ...adminScript, cue, source: "admin" };
    if (!showScript) return null;
    const fired = show?.timeline() ?? null;
    if (fired && fired.key !== appliedKey) {
      appliedKey = fired.key;
      if (fired.paragraph < showScript.paragraphs.length) cue = fired.paragraph;
    }
    return { ...showScript, cue, source: "show" };
  };
  const snapshot = () => { const script = current(); return { script, readerToken: script ? readerToken : null }; };

  return {
    registerReader(app: FastifyInstance) {
      app.get("/api/actor-script", async (request, reply) => {
        reply.header("cache-control", "no-store");
        const script = current();
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
        const paragraphs = scriptParagraphs(parsed.data.text);
        if (paragraphs.length > ACTOR_SCRIPT_MAX_PARAGRAPHS) return reply.code(400).send({ error: "too_many_paragraphs" });
        adminScript = { title: parsed.data.title, paragraphs, revision: randomBytes(16).toString("hex") };
        cue = 0;
        readerToken = randomToken();
        return snapshot();
      });
      admin.patch("/script/cue", async (request, reply) => {
        const parsed = cueSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "invalid_cue" });
        const script = current();
        if (!script || parsed.data.revision !== script.revision) return reply.code(409).send({ error: "script_changed" });
        if (parsed.data.cue >= script.paragraphs.length) return reply.code(400).send({ error: "invalid_cue" });
        cue = parsed.data.cue;
        return snapshot();
      });
      admin.post("/script/rotate-link", async () => { readerToken = randomToken(); return snapshot(); });
      // Clears an Admin override and falls back to the show's script at its latest fired cue.
      admin.delete("/script", async () => { adminScript = null; cue = 0; appliedKey = null; readerToken = randomToken(); return snapshot(); });
    },
  };
}
