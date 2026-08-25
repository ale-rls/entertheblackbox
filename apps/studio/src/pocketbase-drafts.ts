import PocketBase from "pocketbase";
import type { DraftDatabase } from "./drafts.js";
import type { Draft } from "./model.js";

const REVISIONS_TO_KEEP = 20;

type DraftRecord = { id: string; draftId: string; name: string; updatedAt: number; project: unknown; document: unknown };

function toDraft(record: DraftRecord): Draft {
  return {
    id: record.draftId,
    name: record.name,
    updatedAt: record.updatedAt,
    project: record.project as Draft["project"],
    document: record.document as Draft["document"],
  };
}

/**
 * DraftDatabase backed by PocketBase instead of browser IndexedDB, so
 * Studio drafts survive across devices/browsers. `localMediaSources` is
 * deliberately not persisted here: it's a list of local file paths
 * recomputed each session from the machine's own media directory (see
 * App.tsx's refreshDraftLocalMedia effect), not something that should
 * round-trip through shared storage.
 */
export class PocketbaseDraftDatabase implements DraftDatabase {
  private readonly pb: PocketBase;

  constructor(url: string) {
    this.pb = new PocketBase(url);
  }

  async list(): Promise<Draft[]> {
    const records = await this.pb.collection<DraftRecord>("studio_drafts").getFullList({ sort: "-updatedAt" });
    return records.map(toDraft);
  }

  async revisions(id: string): Promise<Draft[]> {
    const filter = this.pb.filter("draftId = {:id}", { id });
    const records = await this.pb.collection<DraftRecord>("studio_draft_revisions")
      .getFullList({ filter, sort: "-updatedAt" });
    return records.map(toDraft);
  }

  async put(draft: Draft): Promise<void> {
    const data = { draftId: draft.id, name: draft.name, updatedAt: draft.updatedAt, project: draft.project, document: draft.document };
    const latest = await this.pb.collection<DraftRecord>("studio_drafts")
      .getFirstListItem(this.pb.filter("draftId = {:id}", { id: draft.id }))
      .catch(() => null);
    if (latest) await this.pb.collection("studio_drafts").update(latest.id, data);
    else await this.pb.collection("studio_drafts").create(data);

    await this.pb.collection("studio_draft_revisions").create(data);

    const filter = this.pb.filter("draftId = {:id}", { id: draft.id });
    const allRevisions = await this.pb.collection<DraftRecord>("studio_draft_revisions")
      .getFullList({ filter, sort: "-updatedAt" });
    const stale = allRevisions.slice(REVISIONS_TO_KEEP);
    await Promise.all(stale.map((record) => this.pb.collection("studio_draft_revisions").delete(record.id)));
  }

  async delete(id: string): Promise<void> {
    const filter = this.pb.filter("draftId = {:id}", { id });
    const [drafts, revisions] = await Promise.all([
      this.pb.collection<DraftRecord>("studio_drafts").getFullList({ filter }),
      this.pb.collection<DraftRecord>("studio_draft_revisions").getFullList({ filter }),
    ]);
    await Promise.all([
      ...drafts.map((record) => this.pb.collection("studio_drafts").delete(record.id)),
      ...revisions.map((record) => this.pb.collection("studio_draft_revisions").delete(record.id)),
    ]);
  }
}
