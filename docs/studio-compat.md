# Show Studio runtime compatibility

The checked-in `@smartphonecracy/scenario` schemas and validators are the
authoritative import/export contract. The Studio adapter imports those schemas;
it does not maintain a second runtime schema.

## Implemented compatibility matrix

| Runtime area | Implemented shape | Adapter behavior |
| --- | --- | --- |
| Scenario version | Non-empty string | Preserved; no Studio-specific version coercion |
| Entry and cycles | `entryPhaseId` plus scenario-level `cyclesAllowed` | Preserved and graph-validated |
| Idle | `{ kind: "idle", id: "idle" }` | Preserved |
| Video transition | `next` is a phase-ID string | Preserved; no hypothetical transition object |
| Position-question field | `four-quadrant` with X+Y axes, or `two-quadrant` with one active X/Y axis and a `split`/`spectrum` variant | Preserved, rendered, and correlated with transition outcomes; legacy two-quadrant fields default to `spectrum` |
| Position-question transition | Discriminated `fixed` or `quadrant-plurality`; plurality maps are q1–q4 for four quadrants and min/max for two | Preserved and graph-validated |
| Media manifest | `{ files: [{ src, bytes, hash }] }` | Preserved; durations belong to video phases, not the manifest |
| Unknown runtime fields | Not interpreted by the current canonical schema | Raw-carried and restored on export; phase and manifest-file extensions follow stable `id`/`src` identities through collection edits |

## Unknown fields and versioning

Imports are parsed by the canonical Zod schemas. Known fields become the
editable canonical model. Fields stripped by those schemas are retained in a
separate `runtimeExtensions` sidecar and merged back at the same location on
compile. Reorderable top-level phase and manifest-file arrays are keyed by their
validator-enforced unique `id` and `src`; index alignment is used only inside
collections without a stable runtime identity. Known edited values win over sidecar values. Studio-only layout and
viewport data therefore cannot leak into runtime JSON, while a no-edit
import/export does not silently destroy fields written by a newer runtime.

Legacy position questions with top-level `xAxis` and `yAxis` fields are consumed
as canonical `field: { type: "four-quadrant", ... }` before extension capture.
Canonical exports therefore use the schema-v2 field shape without leaking the
legacy keys through the raw-carry sidecar. The migration is lossless because the
legacy format could only describe four-quadrant questions.

An incompatible change to a known field still fails canonical parsing; it is
not disguised as an extension. `compileStudioGraph()` reparses both artifacts
and finishes with the existing graph/media-reference validator. Invalid runtime
output is rejected. A future runtime schema version should first update
`@smartphonecracy/scenario`; the adapter then adopts it through that dependency
and adds a compatibility fixture before Studio exposes the new fields for edit.
