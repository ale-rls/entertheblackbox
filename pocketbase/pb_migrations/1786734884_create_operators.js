/// <reference path="../pb_data/types.d.ts" />

// Auth collection for the admin dashboard ("protected operational
// interface"), replacing the single shared ADMIN_TOKEN bearer secret.
// Deliberately NOT the built-in _superusers collection: a show operator
// who can start/stop/skip a running installation should not also get full
// database access to every other collection. Accounts are provisioned with
// `pocketbase/scripts/create-operator.sh` (superuser-only createRule below
// — no public self-registration for a protected interface).
migrate((app) => {
  const collection = new Collection({
    type: "auth",
    name: "operators",
    listRule: null,
    viewRule: "id = @request.auth.id",
    createRule: null,
    updateRule: "id = @request.auth.id",
    deleteRule: null,
    passwordAuth: { enabled: true, identityFields: ["email"] },
    otp: { enabled: false },
    oauth2: { enabled: false },
    mfa: { enabled: false },
    fields: [
      { type: "select", name: "role", required: true, maxSelect: 1, values: ["operator"] },
    ],
  });
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("operators");
  app.delete(collection);
});
