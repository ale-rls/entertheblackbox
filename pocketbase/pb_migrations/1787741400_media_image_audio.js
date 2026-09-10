/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("media");
  collection.fields.getByName("file").mimeTypes = [
    "video/mp4",
    "video/webm",
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/mpeg",
    "audio/mp3",
  ];
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("media");
  collection.fields.getByName("file").mimeTypes = ["video/mp4", "video/webm"];
  app.save(collection);
});
