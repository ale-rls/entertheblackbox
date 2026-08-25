/// <reference path="../pb_data/types.d.ts" />

// Persists an operator-set installationId/roomId override so it survives a
// server restart/redeploy. We assume one show runs at a time: the server
// reads this collection once at startup (apps/server/src/index.ts) and,
// if a record exists, uses it in place of the INSTALLATION_ID/ROOM_ID env
// vars for the rest of the process lifetime -- installationId/roomId are
// baked into long-lived, per-process objects (PhaseEngine, AdmissionController,
// MovementRecorder) and every already-connected client/issued join token,
// so changing them live without a restart would either do nothing or break
// active connections mid-show. Superuser-only, same as every other
// server-authored collection: operators change this through
// apps/server's own /api/admin/installation route, never directly.
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "installation_config",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "text", name: "installationId", required: true },
      { type: "text", name: "roomId", required: true },
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("installation_config");
  app.delete(collection);
});
