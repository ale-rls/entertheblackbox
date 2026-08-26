/// <reference path="../pb_data/types.d.ts" />

// Adds the operator's chosen active show, alongside the existing
// installation/room override (same collection, same "persist now, apply
// on next restart" mechanism -- see 1787672787_create_installation_config.js).
// installationId/roomId become optional here so a "just set the active
// show" save doesn't need to resend them: this collection holds one
// record with independently-settable fields now, not an all-or-nothing tuple.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("installation_config");
  collection.fields.getByName("installationId").required = false;
  collection.fields.getByName("roomId").required = false;
  collection.fields.add(new Field({
    type: "text",
    name: "activeShowId",
    required: false,
  }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("installation_config");
  collection.fields.getByName("installationId").required = true;
  collection.fields.getByName("roomId").required = true;
  collection.fields.removeByName("activeShowId");
  app.save(collection);
});
