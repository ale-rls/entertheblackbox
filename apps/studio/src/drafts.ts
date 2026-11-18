import type { Draft } from "./model.js";

export type SaveStatus = "saving" | "saved" | "error";
export interface DraftDatabase {
  list(): Promise<Draft[]>;
  revisions(id: string): Promise<Draft[]>;
  put(draft: Draft): Promise<void>;
  delete(id: string): Promise<void>;
}

type PendingSave = {
  draft: Draft;
  timer?: ReturnType<typeof setTimeout>;
  write?: Promise<boolean>;
  failed?: boolean;
};

export class Autosave {
  status: SaveStatus = "saved";
  private readonly pending = new Map<string, PendingSave>();
  private writes = Promise.resolve();
  private changed: ((status: SaveStatus) => void) | undefined;

  constructor(private db: DraftDatabase, private delayMs = 500) {}

  schedule(draft: Draft, changed?: (status: SaveStatus) => void) {
    clearTimeout(this.pending.get(draft.id)?.timer);
    this.changed = changed;
    const save: PendingSave = { draft };
    this.pending.set(draft.id, save);
    save.timer = setTimeout(() => { void this.write(save); }, this.delayMs);
    this.reportStatus();
  }

  async flush(id: string): Promise<boolean> {
    for (let save = this.pending.get(id); save; save = this.pending.get(id)) {
      // A failed save stays available for a subsequent close or explicit retry.
      const saved = await (save.write ?? this.write(save));
      if (!saved && this.pending.get(id) === save) return false;
    }
    return true;
  }

  retryFailed() {
    for (const [id, save] of this.pending) {
      if (save.failed) void this.flush(id);
    }
  }

  deleteDraft(id: string): Promise<void> {
    const save = this.pending.get(id);
    if (!save) return this.db.delete(id);
    clearTimeout(save.timer);
    this.pending.delete(id);
    const remove = async () => {
      // Earlier revisions can be queued even when the latest snapshot is still debouncing.
      await this.writes;
      try {
        await this.db.delete(id);
      } catch (error) {
        if (!this.pending.has(id)) {
          delete save.write;
          save.failed = true;
          this.pending.set(id, save);
        }
        throw error;
      } finally {
        this.reportStatus();
      }
    };
    return remove();
  }

  private write(save: PendingSave): Promise<boolean> {
    const { draft } = save;
    clearTimeout(save.timer);
    save.failed = false;
    // PocketBase can cancel overlapping collection writes, even across draft IDs.
    const write = this.writes.then(() => this.db.put(draft));
    this.writes = write.catch(() => {});
    const finish = (saved: boolean) => {
      if (this.pending.get(draft.id) === save) {
        if (saved) this.pending.delete(draft.id);
        else {
          save.failed = true;
          delete save.write;
        }
        this.reportStatus();
      }
      return saved;
    };
    save.write = write.then(() => finish(true), () => finish(false));
    this.reportStatus();
    return save.write;
  }

  private reportStatus() {
    const failed = [...this.pending.values()].some((save) => save.failed);
    const status = failed ? "error" : this.pending.size ? "saving" : "saved";
    if (status === this.status) return;
    this.status = status;
    this.changed?.(status);
  }
}

export async function recoverDraft(db: DraftDatabase, id: string): Promise<Draft | undefined> {
  const candidates = [...(await db.list()).filter((draft) => draft.id === id), ...(await db.revisions(id))];
  return candidates.find((draft) =>
    draft?.project?.scenario?.phases?.length > 0 && draft.document?.studioFormatVersion === 1,
  );
}
