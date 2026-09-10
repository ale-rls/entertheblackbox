/// <reference path="../pb_data/types.d.ts" />

// One-off automatic show start times configured by an operator. This lives in
// a separate collection from installation_config because lobby changes apply
// live and must not trigger the server-restart subscription used for show and
// ghost configuration changes.
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "lobby_config",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "json", name: "startTimes", required: false, maxSize: 100000 },
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("lobby_config");
  app.delete(collection);
});
