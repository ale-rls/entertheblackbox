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
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private db: DraftDatabase, private delayMs = 500) {}
  schedule(draft: Draft, changed?: (status: SaveStatus) => void) {
    clearTimeout(this.timer);
    this.status = "saving";
    changed?.(this.status);
    this.timer = setTimeout(async () => {
      try {
        await this.db.put(draft);
        this.status = "saved";
      } catch {
        this.status = "error";
      }
      changed?.(this.status);
    }, this.delayMs);
  }
}

export async function recoverDraft(db: DraftDatabase, id: string): Promise<Draft | undefined> {
  const candidates = [...(await db.list()).filter((draft) => draft.id === id), ...(await db.revisions(id))];
  return candidates.find((draft) =>
    draft?.project?.scenario?.phases?.length > 0 && draft.document?.studioFormatVersion === 1,
  );
}
