/// <reference path="../pb_data/types.d.ts" />

// Collections backing the persistence layer that previously had no durable
// store at all: admin errors/audit (AdminDataSource was never implemented in
// production), phase-engine checkpoints, final vote snapshots, published
// scenario content, and Studio's authoring drafts (previously browser-only
// IndexedDB). All writes go through the server/Studio authenticating as a
// PocketBase superuser, so every rule below is left as `null` (superuser
// only) rather than opened up publicly.
migrate((app) => {
  const collections = [
    new Collection({
      type: "base",
      name: "admin_errors",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "message", required: true },
        { type: "text", name: "at", required: true },
        { type: "text", name: "path", required: true },
      ],
      indexes: [
        "CREATE INDEX idx_admin_errors_at ON admin_errors (at)",
      ],
    }),
    new Collection({
      type: "base",
      name: "admin_audit",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "action", required: true },
        { type: "text", name: "at", required: true },
        { type: "json", name: "detail", maxSize: 2000000 },
      ],
      indexes: [
        "CREATE INDEX idx_admin_audit_at ON admin_audit (at)",
      ],
    }),
    new Collection({
      type: "base",
      name: "session_checkpoints",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "sessionId", required: true },
        { type: "text", name: "phaseId", required: true },
        { type: "number", name: "phaseEpoch", required: true },
        { type: "select", name: "kind", required: true, maxSelect: 1, values: ["transition", "recovery"] },
        { type: "text", name: "reason", required: true },
        { type: "number", name: "startedAt", required: true },
        { type: "number", name: "deadlineAt" },
        { type: "text", name: "installationId", required: true },
        { type: "text", name: "roomId", required: true },
      ],
      indexes: [
        "CREATE INDEX idx_session_checkpoints_session ON session_checkpoints (sessionId)",
      ],
    }),
    new Collection({
      type: "base",
      name: "vote_snapshots",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "sessionId", required: true },
        { type: "text", name: "questionId", required: true },
        { type: "number", name: "phaseEpoch", required: true },
        { type: "number", name: "recordedAt", required: true },
        { type: "json", name: "votes", required: true, maxSize: 5000000 },
      ],
      indexes: [
        "CREATE INDEX idx_vote_snapshots_session ON vote_snapshots (sessionId)",
      ],
    }),
    new Collection({
      type: "base",
      name: "scenarios",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "showId", required: true },
        { type: "text", name: "version", required: true },
        { type: "select", name: "status", required: true, maxSelect: 1, values: ["draft", "published"] },
        { type: "json", name: "scenario", required: true, maxSize: 5000000 },
        { type: "json", name: "mediaManifest", required: true, maxSize: 5000000 },
        { type: "number", name: "publishedAt" },
      ],
      indexes: [
        "CREATE INDEX idx_scenarios_show ON scenarios (showId)",
        "CREATE INDEX idx_scenarios_status ON scenarios (status)",
      ],
    }),
    // studio_drafts/studio_draft_revisions are the one pair of collections
    // left public: Studio is a browser-only local authoring tool with no
    // auth system of its own (its previous store was unauthenticated
    // IndexedDB), so requiring superuser credentials here would mean
    // shipping the superuser password inside the browser bundle instead.
    new Collection({
      type: "base",
      name: "studio_drafts",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { type: "text", name: "draftId", required: true },
        { type: "text", name: "name", required: true },
        { type: "number", name: "updatedAt", required: true },
        { type: "json", name: "project", required: true, maxSize: 5000000 },
        { type: "json", name: "document", required: true, maxSize: 5000000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_studio_drafts_draft_id ON studio_drafts (draftId)",
      ],
    }),
    new Collection({
      type: "base",
      name: "studio_draft_revisions",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { type: "text", name: "draftId", required: true },
        { type: "text", name: "name", required: true },
        { type: "number", name: "updatedAt", required: true },
        { type: "json", name: "project", required: true, maxSize: 5000000 },
        { type: "json", name: "document", required: true, maxSize: 5000000 },
      ],
      indexes: [
        "CREATE INDEX idx_studio_draft_revisions_draft_id ON studio_draft_revisions (draftId, updatedAt)",
      ],
    }),
  ];

  for (const collection of collections) app.save(collection);
}, (app) => {
  const names = [
    "admin_errors",
    "admin_audit",
    "session_checkpoints",
    "vote_snapshots",
    "scenarios",
    "studio_drafts",
    "studio_draft_revisions",
  ];
  for (const name of names) {
    const collection = app.findCollectionByNameOrId(name);
    app.delete(collection);
  }
});
