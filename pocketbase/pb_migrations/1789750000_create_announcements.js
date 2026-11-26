/// <reference path="../pb_data/types.d.ts" />

// Operator voice announcements (Admin → Show → Announcements): text the
// server spoke with the show's AI voice, kept so the operator can replay it.
// Superuser-only: only the server reads or writes them. Deliberately not the
// `media` collection -- the server restarts whenever `media` changes, which
// must never happen mid-show.
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "announcements",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "text", required: true, max: 2000 },
      { type: "number", name: "durationMs", required: true, onlyInt: true, min: 1 },
      { type: "file", name: "file", required: true, maxSelect: 1, maxSize: 50000000, mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave"], protected: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("announcements"));
});
