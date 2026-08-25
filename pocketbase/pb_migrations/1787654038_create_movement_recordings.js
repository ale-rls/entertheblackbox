/// <reference path="../pb_data/types.d.ts" />

// Movement-path recordings captured server-side from each participant's
// authoritative `input` WS messages during a live show session, for later
// "ghost player" replay to fill out audience-sparse shows. Recording is
// split into a lightweight parent row per player-per-session
// (movement_recordings) and periodic JSON-array sample batches
// (movement_recording_batches), mirroring session_checkpoints/vote_snapshots.
// Superuser-only, like every other server-persistence collection.
migrate((app) => {
  const collections = [
    new Collection({
      type: "base",
      name: "movement_recordings",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "recordingId", required: true },
        { type: "text", name: "sessionId", required: true },
        { type: "text", name: "participantId", required: true },
        { type: "text", name: "showId", required: true },
        { type: "text", name: "scenarioVersion", required: true },
        { type: "text", name: "installationId", required: true },
        { type: "text", name: "roomId", required: true },
        { type: "number", name: "startedAt", required: true },
        { type: "number", name: "endedAt" },
        { type: "select", name: "status", required: true, maxSelect: 1, values: ["recording", "completed", "abandoned"] },
        // Not required: PocketBase's "required" validator treats a literal
        // 0 as blank for number fields, and a fresh/short recording
        // legitimately has sampleCount 0. Defaults to 0 when omitted.
        { type: "number", name: "sampleCount" },
      ],
      indexes: [
        "CREATE INDEX idx_movement_recordings_session ON movement_recordings (sessionId)",
        "CREATE UNIQUE INDEX idx_movement_recordings_recording_id ON movement_recordings (recordingId)",
      ],
    }),
    new Collection({
      type: "base",
      name: "movement_recording_batches",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "recordingId", required: true },
        { type: "text", name: "sessionId", required: true },
        // Not required: the first batch of a recording is legitimately
        // index 0, and PocketBase's "required" validator rejects a literal
        // 0 on number fields as blank.
        { type: "number", name: "batchIndex" },
        { type: "number", name: "recordedAt", required: true },
        { type: "json", name: "samples", required: true, maxSize: 2000000 },
      ],
      indexes: [
        "CREATE INDEX idx_movement_recording_batches_recording ON movement_recording_batches (recordingId)",
      ],
    }),
  ];

  for (const collection of collections) app.save(collection);
}, (app) => {
  for (const name of ["movement_recordings", "movement_recording_batches"]) {
    const collection = app.findCollectionByNameOrId(name);
    app.delete(collection);
  }
});
