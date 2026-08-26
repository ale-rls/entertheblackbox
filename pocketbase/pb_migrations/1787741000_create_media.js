/// <reference path="../pb_data/types.d.ts" />

// Studio's "Add Media" library. Previously media only ever lived on a
// content author's own machine (a Vite dev-server-only upload endpoint
// writing into content/media/), which meant it worked from `vite dev` but
// not from a deployed Studio, and never survived a redeploy either way.
// Storing the files in PocketBase (which already has a persistent volume,
// see pocketbase/Dockerfile) fixes both: Studio uploads here from any
// environment, and apps/server mirrors this collection down into its own
// local content/media/ at boot (persistence/media-sync.ts) so its
// existing disk-backed validate/serve pipeline is unchanged.
//
// Rules left open like studio_drafts/studio_draft_revisions: Studio is a
// browser-only authoring tool with no auth system of its own, so gating
// this on superuser credentials would mean shipping the superuser
// password into the browser bundle. The real security boundary is
// /api/admin/publish, which does require an operator token.
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "media",
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
    fields: [
      { type: "text", name: "src", required: true },
      { type: "number", name: "bytes", required: true },
      { type: "text", name: "hash", required: true },
      { type: "number", name: "durationMs" },
      {
        type: "file",
        name: "file",
        required: true,
        maxSelect: 1,
        maxSize: 2147483648,
        mimeTypes: ["video/mp4", "video/webm"],
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_media_src ON media (src)",
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("media");
  app.delete(collection);
});
