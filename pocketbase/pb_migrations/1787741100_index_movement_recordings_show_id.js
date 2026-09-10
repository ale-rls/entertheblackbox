/// <reference path="../pb_data/types.d.ts" />

// Ghost cursor replay (apps/server/src/ghosts) loads its pool with exactly
// this filter shape -- showId + status="completed" -- at every server
// boot. The collection previously only indexed sessionId/recordingId,
// both useless for this query; without this, the lookup falls back to a
// full scan that only gets slower as more shows accumulate history.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("movement_recordings");
  collection.indexes.push("CREATE INDEX idx_movement_recordings_show_id ON movement_recordings (showId, status)");
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("movement_recordings");
  collection.indexes = collection.indexes.filter(
    (index) => !index.includes("idx_movement_recordings_show_id"),
  );
  app.save(collection);
});
