import type { Draft } from "./model.js";

export type SaveStatus = "saving" | "saved" | "error";
export interface DraftDatabase {
  list(): Promise<Draft[]>;
  revisions(id: string): Promise<Draft[]>;
  put(draft: Draft): Promise<void>;
  delete(id: string): Promise<void>;
}

export class Autosave {
  status: SaveStatus = "saved";
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes = Promise.resolve();
  private latestSchedule = 0;

  constructor(private db: DraftDatabase, private delayMs = 500) {}

  schedule(draft: Draft, changed?: (status: SaveStatus) => void) {
    clearTimeout(this.timers.get(draft.id));
    const schedule = ++this.latestSchedule;
    this.status = "saving";
    this.timers.set(draft.id, setTimeout(() => {
      this.timers.delete(draft.id);
      // PocketBase uses the same request key for draft lookups, even across draft IDs.
      const write = this.writes.then(() => this.db.put(draft));
      this.writes = write.catch(() => {});
      const finish = (status: SaveStatus) => {
        if (schedule !== this.latestSchedule) return;
        this.status = status;
        changed?.(status);
      };
      void write.then(() => finish("saved"), () => finish("error"));
    }, this.delayMs));
    changed?.(this.status);
  }
}

export async function recoverDraft(db: DraftDatabase, id: string): Promise<Draft | undefined> {
  const candidates = [...(await db.list()).filter((draft) => draft.id === id), ...(await db.revisions(id))];
  return candidates.find((draft) =>
    draft?.project?.scenario?.phases?.length > 0 && draft.document?.studioFormatVersion === 1,
  );
}
