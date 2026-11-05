# Show Studio curator guide

Show Studio is the visual authoring tool for production scenarios and their media manifests. An authenticated operator can publish an immutable version to PocketBase. Publishing during a live session is deferred until that session ends and the server restarts safely.

## Create or import

Open the Studio with `pnpm --filter studio dev`. On each page load, the local development server scans `content/media` and generates its in-memory media manifest from the files' relative paths, sizes, and SHA-256 hashes. **New show** uses that inventory immediately, opened drafts receive the refreshed local entries, and video phases suggest the discovered paths in the **Media source** field. Local files removed since the previous scan are pruned; imported-only entries remain available. A production/static Studio has no filesystem endpoint and continues to use explicit runtime or backup imports.

Choose **New show** for a minimal idle-only project, or import `scenario.json` and `media-manifest.json` together. File selection order does not matter. To resume from an exported package, select its runtime JSON files and `.studio.json` together; `validation-report.json` and `README.txt` may be included and are recognized as package metadata. The saved canvas layout, viewport, and notes are restored only when `.studio.json` is present. A Studio backup can be imported by itself. Mixed, duplicate, malformed, or version-mismatched artifacts are rejected rather than partially imported. Drafts autosave in this browser; the status in the toolbar reports saving, saved, or error.

Use the node palette to add phases, connect their typed handles, and select a node to edit its properties. The End node means “return to idle/attract”; the required runtime `idle` phase stays in the exported scenario without appearing as a duplicate canvas node. A position question can use four quadrants (both X and Y axes) or two quadrants (one active axis). Four-quadrant outputs are q2 top-left, q1 top-right, q3 bottom-left, and q4 bottom-right; the exact center belongs to q4. Two-quadrant X questions divide left/right and Y questions divide top/bottom; their stable outputs are `min` and `max`, and exactly 0.5 belongs to max (right or bottom). Studio labels these outputs with their spatial position and authored endpoint text. Runtime IDs must be unique. Undo is available for inspector changes, including destructive phase-type, transition, and quadrant-layout changes.

Participant devices use the native iOS/Android app only. The **Phone headphones** field (`phoneAudioSrc`) selects downloaded narration; group overrides choose targeted tracks. Publish with the top-right **Publish** button; all outputs and native devices share that selected version. Include enough phase time for narration. No browser stream fallback is supported.

Select a phase and open **Stage monitors** to author M1–M4 video, image, text, placeholder and blank cues, with offsets and optional durations. Select image/video assets through the shared media picker. The main server clock drives all four screens; see [monitor setup](monitor-displays.md).

## Validate and preview

The Validation and media panel lists blocking errors, warnings, media references, and per-branch budgets. Fix every error. Review and explicitly acknowledge each required warning; acknowledgement is a deliberate sign-off, not a way to make an error exportable.

Preview starts at the configured entry phase. Advance video and question timers manually, force each fixed/quadrant/tie/empty outcome, and exercise stale, disconnected, and abandoned-solo cases. Four-quadrant questions expose q1–q4; two-quadrant questions expose min/max. The frozen result shows counted and excluded votes, quadrant totals, winner, and resolved target.

### Rehearsing on devices

The editor top bar no longer offers **Preview on devices** or **Preview from here**. Rehearse by publishing the show to a venue server and running it from Admin with real displays and native apps. TouchDesigner monitor helpers are no longer part of this workflow.

## Export and hand off

The file-based **Export files** and **Export for deployment** actions are retired from the File menu; **Publish** (top right) is the hand-off. It is disabled while Diagnostics report errors or unacknowledged warnings; the issue count beside it opens the Diagnostics panel.

Use **File → Save backup** for a restorable working draft. Browser storage is convenient, not an archival system; export a backup at each curator handoff.

## Recovery and limitations

If the newest IndexedDB revision is corrupt, reopening a recent draft recovers the last valid revision. If recovery is unavailable, import the last exported backup. V1 has no collaborative editing, accounts, direct publishing, media transcoding, or remote control. Multi-participant cursor dragging is the only approved post-v1 preview exclusion; outcome shortcuts cover the same resolution branches in v1.

The checked-in example is `content/scenarios/dev.json` with `content/media-manifest.json`. It includes a video, a fixed question, a four-quadrant question, a two-quadrant question, shared targets, and an idle end.

## V1 acceptance record

All §18 requirements are covered by adapter/unit/e2e regression tests: fixture import and canonical round-trip; runtime-validator-gated export; UI authoring; fixed, four-quadrant, and two-quadrant transitions with shared targets; unreachable/cycle diagnostics; all outcome presets; distinct-media and 2 GiB gates; reload-persistent drafts and corrupt-revision recovery; runtime/layout separation; and versioned reproducible exports. This is the original V1 acceptance record; Studio now also publishes through the authenticated server API. The sole deferred item is multi-participant drag simulation (STEP-044); it is not an §18 acceptance-row omission.

## Publish the show

On the venue server click **Publish** in the top-right corner of the editor, sign in as an operator, confirm the name and optional background music, then publish. The server validates the current graph and media, prepares immutable visual/audio assets, saves one version and selects it for projection, M1–M4 and native devices. A running performance keeps its current version until it ends.

No separate native channel publication is required. Phones check/download the running show before joining. See [publishing.md](publishing.md) for preparation, failures and activation.
