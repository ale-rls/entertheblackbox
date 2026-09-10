/// <reference path="../pb_data/types.d.ts" />

// Every publish creates a new `scenarios` record rather than updating
// one, and the server picks whichever `status = "published"` record has
// the newest publishedAt -- there was never an explicit "this show is
// active" choice, just implicit "whatever was published last". Adding
// an admin-facing "pick the active show" dropdown (apps/server's
// /api/admin/shows) needs something more readable than the raw showId
// UUID to label each option with, hence this field.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("scenarios");
  collection.fields.add(new Field({
    type: "text",
    name: "name",
    required: false,
  }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("scenarios");
  collection.fields.removeByName("name");
  app.save(collection);
});
