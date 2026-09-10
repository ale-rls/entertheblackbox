# Show Studio

## Compatibility-first implementation plan

Status: ready for engineering handoff

Purpose: build a visual node-based interface for creating and editing Enter the Blackbox shows without rewriting or replacing the existing installation runtime.

## 1. Core constraint

The existing runtime is the compatibility contract.

Show Studio must consume and produce the exact scenario JSON and media-manifest formats already used by the server. It must not require changes to:

- The game server
- The WebSocket protocol
- The display application
- The phone application
- Vote resolution
- Session persistence
- Production deployment

If the implementation differs from the planning document, the checked-in runtime types, validators, and fixtures win. The Studio adapts to them.

The first engineering task is therefore to inventory the actual implemented schema and create compatibility fixtures before building UI.

## 2. V1 product boundary

Show Studio v1 supports:

- Importing an existing show
- Creating a show from an empty template
- Editing the show as a node graph
- Editing node properties
- Managing media references and metadata
- Live graph validation
- Previewing and simulating the show
- Saving local drafts
- Exporting runtime-compatible scenario and manifest files
- Exporting separate Studio layout metadata

V1 does not:

- Publish directly to the live installation
- Change an active show remotely
- Replace the existing repository/CI deployment workflow
- Provide public multi-user accounts
- Support collaborative editing
- Allow arbitrary JavaScript or formulas
- Modify runtime schemas automatically
- Upload or transcode production media unless an existing media API already supports it

## 3. Technology

- TypeScript
- React + Vite
- React Flow (`@xyflow/react`) for the graph canvas
- Existing shared runtime types and Zod schemas
- IndexedDB for browser-local drafts
- Vitest for compiler, adapter, and validation tests
- Playwright for Studio interaction and export tests

[React Flow](https://reactflow.dev/) provides the required canvas primitives: custom React nodes, handles, dragging, zooming, panning, selection, and graph interaction. Its documented save/restore model can be used for Studio layout state while runtime data remains separate. [Save and restore example](https://reactflow.dev/examples/interaction/save-and-restore)

Add the Studio to the existing monorepo as:

```text
apps/
  studio/

packages/
  scenario/          existing canonical runtime schema and validation
  studio-adapter/    graph ↔ runtime conversion
  studio-simulator/  preview adapter using existing runtime logic
```

Do not duplicate runtime types inside `apps/studio`.

## 4. Data separation

The runtime scenario and visual-editor layout are different artifacts.

### Runtime artifact

Consumed by the existing installation server:

```text
scenario.json
media-manifest.json
```

Its shape must remain exactly compatible with the current implementation.

### Studio artifact

Used only to preserve editor state:

```text
show-name.studio.json
```

It contains:

```ts
type StudioDocument = {
  studioFormatVersion: number;
  runtimeScenarioVersion: string;
  showId: string;
  nodes: StudioNodeLayout[];
  edges: StudioEdgeLayout[];
  viewport: { x: number; y: number; zoom: number };
  notes?: Record<string, string>;
};
```

The Studio document may store canvas position, grouping, comments, and visual preferences. None of those fields may leak into the runtime scenario unless the runtime schema already defines them.

If an existing runtime scenario is imported without Studio metadata, the Studio generates an automatic initial layout.

## 5. Conversion architecture

Use a strict adapter boundary:

```text
Existing runtime JSON
        │
        ▼
parseRuntimeScenario()
        │
        ▼
Studio graph model
        │
        ├── edit / preview / validate
        │
        ▼
compileStudioGraph()
        │
        ▼
Existing runtime validator
        │
        ▼
Runtime-compatible JSON
```

Required functions:

```ts
parseRuntimeScenario(
  scenario: unknown,
  manifest: unknown
): StudioProject

compileStudioGraph(
  project: StudioProject
): {
  scenario: RuntimeScenario;
  manifest: RuntimeMediaManifest;
}

validateStudioProject(
  project: StudioProject
): StudioDiagnostic[]
```

`compileStudioGraph()` must finish by calling the existing runtime validator. A Studio export that the server would reject is a Studio bug.

## 6. Studio information architecture

### Project home

- New show
- Import existing show
- Open recent local draft
- Duplicate show
- Export backup
- Delete local draft with confirmation

### Editor screen

```text
┌──────────────┬─────────────────────────────┬──────────────────┐
│ Node palette │                             │ Properties       │
│              │         Graph canvas        │ inspector        │
│ Media        │                             │                  │
│ library      │                             │                  │
├──────────────┴─────────────────────────────┴──────────────────┤
│ Validation / preview / export status                          │
└───────────────────────────────────────────────────────────────┘
```

Top toolbar:

- Show name
- Save status
- Undo/redo
- Validate
- Preview
- Export
- Fit graph

## 7. Node types

The available nodes must reflect the actual implemented runtime schema. Do not expose hypothetical node types.

The expected initial set is:

### Entry node

Editor-only marker for the runtime’s configured first phase.

- Exactly one per show
- One outgoing connection
- Not emitted as an additional runtime phase

### Idle/attract runtime phase

The required runtime idle phase remains in the scenario data, but is represented
on the canvas by the editor-only End node rather than by a duplicate phase node.

- Cannot contain runtime fields that do not already exist

### Video node

Properties:

- Runtime ID
- Label for Studio display
- Media reference
- Expected duration
- Allow-skip setting if supported
- Next phase

One outgoing handle labelled `next`.

### Position-question node

Properties:

- Runtime ID
- Question text
- Quadrant layout: four quadrants (X + Y axes), two left/right quadrants (X axis), or two top/bottom quadrants (Y axis)
- Endpoint labels for every active axis
- Voting duration
- Freeze duration
- Connection-stale threshold
- Show-live-counts setting
- Counted vote statuses
- Transition mode

For a fixed transition, show one output handle:

```text
next
```

For four-quadrant plurality, show six output handles:

```text
q1  q2  q3  q4  tie  empty
```

For two-quadrant plurality, show four output handles. The Studio presents them
as spatial quadrants with their authored endpoint labels; `min` and `max` are
stable runtime IDs:

```text
min  max  tie  empty
```

Quadrant naming must be visible in the node and preview:

```text
q2 top-left       q1 top-right
q3 bottom-left    q4 bottom-right
```

For a two-quadrant X field, min is left and max is right. For a two-quadrant Y
field, min is top and max is bottom. Exactly 0.5 belongs to max. The Studio must
display the runtime’s exact axis-boundary convention and must not silently invent
a different one.

### End

Use one editor-only End node as the canvas representation of the existing
runtime idle target. It compiles to `idle`; do not render a second Idle node or
add a new runtime phase type merely to support the editor.

## 8. Connection rules

The editor prevents structurally invalid connections where possible:

- Entry connects to exactly one phase
- Video `next` connects to one valid target
- Fixed question `next` connects to one valid target
- Four-quadrant question requires q1, q2, q3, q4, tie, and empty targets
- Two-quadrant question requires min, max, tie, and empty targets
- Edges may not point to deleted nodes
- Self-loops and cycles use the existing runtime policy
- Multiple handles may connect to the same target
- Tie and empty may intentionally reuse another quadrant’s target

Connection validation should happen while creating an edge, but full validation still runs before preview and export.

## 9. Properties inspector

Selecting a node opens a typed form generated from the Studio’s node model.

Requirements:

- Changes apply immediately to the draft graph
- Runtime IDs are validated and unique
- Destructive type changes require confirmation
- Switching a question from quadrant to fixed, or between two and four quadrants, preserves old connections in undo history but excludes incompatible outcomes from compilation
- Form fields show inline validation errors
- Advanced properties are collapsed by default
- Director-facing labels use plain language; runtime field names may appear as secondary help text

Do not make users edit JSON in normal operation. Provide a read-only compiled JSON inspector for debugging.

## 10. Media library

The Studio media library manages references used by video nodes without replacing the current production media workflow.

V1 capabilities:

- Import the existing media manifest
- List each media ID, filename/URL, byte size, hash, duration, and referencing nodes
- Assign media to a video node
- Detect missing and unused media
- Detect duplicate content hashes
- Sum distinct referenced media against the 2 GiB ceiling
- Show how branching changes the total distinct-media budget
- Export the runtime-compatible media manifest

If local files are selected, browser-side inspection may calculate size and SHA-256. Codec and duration validation should reuse existing tooling where available. Do not implement a parallel transcoding pipeline in the Studio without reviewing the engineers’ current media process.

Media files themselves are not embedded in the Studio document.

## 11. Validation

Diagnostics have three levels:

- Error: blocks preview and export
- Warning: permits preview/export after acknowledgement
- Information: advisory

Required errors:

- Runtime schema fails
- Missing or duplicate runtime ID
- Missing entry phase
- Broken edge target
- Incomplete quadrant mapping
- Missing tie or empty target
- Invalid duration or freeze value
- Invalid counted status
- Missing referenced media
- Declared media size/hash mismatch when verifiable
- Distinct referenced media exceeds 2 GiB

Required warnings:

- Unreachable node
- Intentional or accidental cycle
- Very long maximum path
- Abandoned-solo flow reaches an unreviewed empty target
- Multiple outcomes converge on the same target
- Live counts enabled, because this can influence voter behaviour
- Active-phase QR may overlap important video composition if layout metadata supports its placement
- Question has no valid-vote path in simulation
- Media exists but is never referenced

The diagnostics panel must identify the node and provide a “focus node” action.

## 12. Preview and simulation

Preview is required before export.

It should use the real display components and shared resolution logic wherever possible. Avoid implementing a second, subtly different show engine.

Preview modes:

### Manual walkthrough

- Start from entry
- Play/skip video placeholders
- Advance timers manually
- Move simulated cursors
- Trigger deadline
- Observe freeze and branch resolution

### Outcome shortcuts

- Force q1, q2, q3, or q4 plurality
- Force tie
- Force empty
- Include/exclude stale and disconnected votes
- Simulate an abandoned solo visitor

### Multi-participant simulation

- Add 1–30 synthetic participants
- Drag cursors on the X/Y field
- Randomize positions
- Disconnect participants
- Mark connection stale
- Inspect live quadrant counts
- Confirm resolved target

Preview results should show:

- Individual snapshot records
- Counted/excluded totals
- Quadrant counts
- Winner/tie/empty result
- Resolved target
- Freeze interval

## 13. Draft persistence

V1 drafts are local and do not alter production:

- Autosave graph and layout to IndexedDB after a short debounce
- Display saving/saved/error status
- Maintain undo/redo within the current editing session
- Allow manual export of a complete Studio backup
- Warn before closing when the latest state has not persisted
- Keep a bounded local revision history, for example the last 20 saves

Because full curator authentication is deferred, do not expose the Studio publicly as an unauthenticated production route. V1 should be available through local development, a private VPN, or an existing protected admin boundary.

## 14. Export workflow

Export is deliberately separate from production publishing.

The operator selects “Export for deployment.” The Studio then:

1. Validates the graph.
2. Compiles to the existing runtime scenario.
3. Runs the existing runtime validator.
4. Validates the media manifest and budget.
5. Executes branch simulation smoke tests.
6. Produces a versioned export package.

```text
show-name/
  scenario.json
  media-manifest.json
  show-name.studio.json
  validation-report.json
  README.txt
```

`README.txt` records:

- Export timestamp
- Studio build version
- Runtime schema version
- Scenario/show version
- Validation result
- Media total
- Known warnings

The existing engineering/CI workflow consumes `scenario.json` and `media-manifest.json` exactly as it does today. The Studio metadata is ignored by the runtime.

## 15. Import workflow

Import supports:

- Runtime scenario plus manifest
- Complete Studio export package
- Studio backup document

Import must:

- Parse using the existing runtime schema
- Refuse unknown incompatible versions with a clear message
- Preserve unknown runtime fields when safely possible
- Generate layout for runtime-only imports
- Never silently drop a runtime field
- Produce an import report listing any adaptation or warning

Round-trip compatibility is mandatory:

```text
runtime JSON → import → no edits → export
```

The resulting runtime object must be semantically identical after canonical normalization.

## 16. Optional later publishing phase

Direct publishing is a post-v1 feature and must not block the editor.

When authentication and operational ownership are ready, add:

- `shows`
- `show_drafts`
- `show_versions`
- `media`
- `installations.active_show_version_id`

Publishing then becomes:

```text
Draft
  → server-side validate
  → immutable show version
  → preview approval
  → mark active for next idle session
```

Active sessions remain pinned to their starting version. Publishing content must not mutate a running session or require a software deploy.

This later phase requires proper curator authentication, roles, audit history, and rollback.

## 17. Implementation phases

### Phase A — Compatibility audit

Deliverables:

- Inventory actual runtime scenario types
- Inventory actual media manifest
- Collect real production/development fixtures
- Document runtime versioning behaviour
- Add round-trip fixture tests

Exit criterion: an existing engineer-created show imports and exports without semantic change.

### Phase B — Studio scaffold and adapter

Deliverables:

- `apps/studio`
- `packages/studio-adapter`
- Runtime parser/compiler boundary
- Basic import/export
- IndexedDB draft store

Exit criterion: imported phases render as a basic graph and compile successfully.

### Phase C — Graph editor

Deliverables:

- Node palette
- Custom node components
- Typed handles
- Edge validation
- Inspector forms
- Autosave
- Undo/redo

Exit criterion: a complete show can be created without editing JSON.

### Phase D — Media and validation

Deliverables:

- Manifest import/export
- Media reference browser
- Hash/size inspection
- 2 GiB distinct-media budget
- Full diagnostic panel

Exit criterion: invalid shows cannot be exported.

### Phase E — Preview and simulation

Deliverables:

- Display preview
- Synthetic participant controls
- Fixed/quadrant resolution simulation
- Tie, empty, stale, disconnected, and abandoned-solo presets
- Freeze and target visualization

Exit criterion: every branch can be exercised before export.

### Phase F — Hardening and handoff

Deliverables:

- Playwright editor flows
- Round-trip regression suite
- Keyboard navigation
- Large-graph performance test
- Recovery from corrupt local draft
- User guide
- Example show

Exit criterion: a non-engineer can import, edit, validate, preview, and export a show while the existing runtime accepts the result unchanged.

## 18. Acceptance criteria

- Existing scenario fixtures import successfully.
- Import followed by export preserves runtime semantics.
- The Studio never emits a scenario rejected by the existing runtime validator.
- A show can be created entirely through the UI.
- Fixed position questions expose one target.
- Quadrant questions require q1, q2, q3, q4, tie, and empty targets.
- Multiple outcomes may share a target.
- Unreachable nodes and cycles are surfaced.
- Every branch can be previewed.
- Empty, tie, stale, disconnected, and abandoned-solo outcomes can be simulated.
- The media budget counts distinct referenced files rather than graph edges.
- Media over 2 GiB blocks export.
- Local drafts survive browser reload.
- Studio layout metadata does not alter runtime output.
- Production publishing remains the engineers’ existing workflow.
- No active installation session can be changed from Studio v1.

## 19. Engineering rules

- Extend existing packages; do not fork their schemas.
- Never infer runtime behaviour from node appearance.
- Never silently discard unknown fields.
- Keep conversion functions pure and heavily tested.
- Keep runtime IDs stable when nodes move or labels change.
- Separate warnings from blocking errors.
- Store graph layout separately from runtime content.
- Make all exports versioned and reproducible.
- Treat the existing engineers’ fixtures as regression tests.

## 20. Handoff package

- Studio source code
- Adapter/compiler source code
- Runtime compatibility matrix
- Import/export format documentation
- Round-trip fixture suite
- Validation rule reference
- Preview/simulation guide
- Curator user guide
- Example show project
- Known limitations
- Post-v1 publishing/auth roadmap

The key implementation principle is simple: Show Studio is a visual authoring layer over the system that already exists. It should make the engineers’ scenario format easier to create, not replace the month of runtime work already completed.
