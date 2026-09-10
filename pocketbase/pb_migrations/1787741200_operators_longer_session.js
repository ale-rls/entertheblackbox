/// <reference path="../pb_data/types.d.ts" />

// PocketBase's default auth token duration (5 days) meant an operator
// running /admin or Studio had to re-authenticate constantly during a
// multi-day event. Operators are a small trusted team, not a public
// surface, so a much longer-lived session is a reasonable tradeoff here --
// bump to 30 days. apps/admin also switched from sessionStorage to
// localStorage so the stored token actually survives that long instead of
// being wiped the moment a tab closes.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("operators");
  collection.authToken.duration = 30 * 24 * 60 * 60;
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("operators");
  collection.authToken.duration = 5 * 24 * 60 * 60;
  app.save(collection);
});
