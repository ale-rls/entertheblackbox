/// <reference path="../pb_data/types.d.ts" />

// movement_recordings is also the per-participant, per-session ledger. Keep
// the visitor-facing name beside the stable participantId so session data and
// recorded movement can be inspected together. Optional for compatibility
// with recordings created before names were collected; all new rows set it.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("movement_recordings");
  collection.fields.add(new Field({
    type: "text",
    name: "participantName",
    required: false,
  }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("movement_recordings");
  collection.fields.removeByName("participantName");
  app.save(collection);
});
