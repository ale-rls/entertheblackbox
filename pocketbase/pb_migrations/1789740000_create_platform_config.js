/// <reference path="../pb_data/types.d.ts" />

// Namespaced platform settings. Only the server (superuser) can read/write;
// public routes must explicitly project safe fields for their clients.
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "platform_config",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "key", required: true, max: 100 },
      { type: "json", name: "value", required: true, maxSize: 50000 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_platform_config_key ON platform_config (key)"],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("platform_config"));
});
