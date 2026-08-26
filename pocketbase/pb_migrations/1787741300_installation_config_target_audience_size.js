/// <reference path="../pb_data/types.d.ts" />

// Operator-settable ghost-cursor fill cap, alongside the existing
// activeShowId override (same collection, same "persist now, apply on
// next restart via the PocketBase realtime subscription" mechanism -- see
// 1787730626_installation_config_active_show.js). Takes precedence over
// the published scenario's own targetAudienceSize when set, so an
// operator can dial ghost fill up/down live without republishing from
// Studio.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("installation_config");
  collection.fields.add(new Field({
    type: "number",
    name: "targetAudienceSize",
    required: false,
  }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("installation_config");
  collection.fields.removeByName("targetAudienceSize");
  app.save(collection);
});
