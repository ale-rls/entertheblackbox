# Smartphonecracy tools design system

Status: Phase 1 authoritative design brief  
Applies to: Admin and Show Studio  
Phase 1 deliverable: documentation only

## 1. Scope

This brief defines the shared visual system for the two operator-facing tools:

- `apps/admin`: operational control, monitoring, and intervention
- `apps/studio`: authoring, validation, preview, and export

It is the source of truth for their color, typography, spacing, density, interaction,
component, accessibility, and responsive behavior. Later implementation work may add
shared primitives or styles, but must preserve each application's runtime behavior and
must use the token contract in this document.

The component inventory is derived exclusively from the current Admin and Studio
product flows. A pasted or external design-system catalog does not define the inventory.
Unconsumed generic components are not planned by this brief. Add a future primitive
only when a concrete Admin or Studio use case consumes it.

Explicitly out of scope:

- `apps/display`
- `apps/phone`
- the installation's audience-facing visual language
- server behavior, protocols, scenario schemas, and deployment behavior
- any implementation change during Phase 1

The Display and Phone applications must not inherit these tokens through a global
stylesheet, package side effect, or root-level CSS import. This is a tools-only system.

## 2. Direction

The agreed direction is derived from two references:

1. A light precision dashboard: thin structural rules, compact technical typography,
   disciplined alignment, and dense but legible data.
2. A dark mobile concept: bold cream modular tiles, direct hierarchy, and
   tactile editorial composition.

The midpoint is a **neutral-charcoal and cream editorial workbench**. It combines exact line
work and compact data presentation with occasional bold cream actions. It should feel
purposeful, calm, and slightly tactile—not futuristic, glossy, playful, or luxurious.

### Principles

1. **Structure before decoration.** Alignment, rules, whitespace, and type establish
   hierarchy. Color and shadow do not compensate for weak layout.
2. **Neutral surfaces, warm emphasis.** Use neutral charcoal instead of brown-cast
   black, while retaining cream for text and deliberate emphasis. Large cream fields
   are not the default surface.
3. **Compact, never cramped.** Studio can carry more controls per viewport than Admin,
   but neither may sacrifice readable labels, focus visibility, or target size.
4. **One bold action at a time.** A cream-filled action marks the primary next step in
   a region. Competing actions use outline or quiet treatments.
5. **Meaning survives without color.** Status and domain colors reinforce a label,
   icon, pattern, or shape; they never carry meaning alone.
6. **Tools reveal state.** Saving, validation, connection, destructive intent, and
   disabled state must be explicit and close to the affected control.
7. **Motion explains change.** Use short transitions for state and spatial continuity,
   never ambient motion.

### Shared-style ownership

Both tools load `@smartphonecracy/tool-ui/styles.css`. The shared package owns the
document baseline and visual semantics: color, typography, controls, fields, panels,
feedback, and interaction states. Application stylesheets own layout, positioning,
and app-specific graph or operational presentation; they must not create parallel
visual treatments for the same semantic role.

Use `.sc-tool-eyebrow` for technical overlines and `.sc-tool-copy` for supporting
copy. Both intentionally use the Studio-derived muted text color. Application markup
chooses the semantic role; it does not choose between primary, secondary, or muted
color tokens for equivalent content.

## 3. CSS token contract

Every shared custom property is prefixed `--sc-tool-`. Application CSS may create
private component variables, but it must derive shared decisions from these tokens and
must not redefine token values locally. Hex values are uppercase here for auditability;
CSS matching is case-insensitive.

```css
:root {
  color-scheme: dark;

  /* Neutral-charcoal surface hierarchy */
  --sc-tool-color-canvas: #111111;
  --sc-tool-color-surface-1: #181818;
  --sc-tool-color-surface-2: #202020;
  --sc-tool-color-surface-3: #2A2A2A;
  --sc-tool-color-scrim: rgb(17 17 17 / 78%);

  /* Neutral text hierarchy and cream-surface contrast */
  --sc-tool-color-cream-strong: #F7EDDA;
  --sc-tool-color-text: #F5F5F5;
  --sc-tool-color-text-secondary: #CCCCCC;
  --sc-tool-color-text-muted: #A3A3A3;
  --sc-tool-color-text-on-cream: #17130E;
  --sc-tool-color-text-muted-on-cream: #665E50;

  /* Rules and interaction */
  --sc-tool-color-rule: #484848;
  --sc-tool-color-rule-strong: #767676;
  --sc-tool-color-action: #E8DDC4;
  --sc-tool-color-action-hover: #F4E9D1;
  --sc-tool-color-action-pressed: #D2C6AC;
  --sc-tool-color-focus-on-dark: #FFD166;
  --sc-tool-color-focus-on-cream: #3D4F70;
  --sc-tool-color-selection: #383838;

  /* Semantic status */
  --sc-tool-color-info: #72B7E4;
  --sc-tool-color-success: #77C593;
  --sc-tool-color-warning: #E9B65C;
  --sc-tool-color-danger: #F08072;

  /* Show-domain identity */
  --sc-tool-color-domain-entry: #62C6B2;
  --sc-tool-color-domain-idle: #B2A58D;
  --sc-tool-color-domain-video: #74A7E8;
  --sc-tool-color-domain-question: #D89DD8;
  --sc-tool-color-domain-branch: #E59A6F;

  /* Locally hosted type */
  --sc-tool-font-sans: "Space Grotesk", "Arial", sans-serif;
  --sc-tool-font-mono: "IBM Plex Mono", "Courier New", monospace;
  --sc-tool-font-weight-regular: 400;
  --sc-tool-font-weight-medium: 500;
  --sc-tool-font-weight-semibold: 600;
  --sc-tool-font-size-00: 0.6875rem; /* 11px */
  --sc-tool-font-size-0: 0.75rem;    /* 12px */
  --sc-tool-font-size-1: 0.8125rem;  /* 13px */
  --sc-tool-font-size-2: 0.875rem;   /* 14px */
  --sc-tool-font-size-3: 1rem;       /* 16px */
  --sc-tool-font-size-4: 1.25rem;    /* 20px */
  --sc-tool-font-size-5: 1.75rem;    /* 28px */
  --sc-tool-line-height-tight: 1.15;
  --sc-tool-line-height-ui: 1.35;
  --sc-tool-line-height-copy: 1.55;
  --sc-tool-letter-spacing-label: 0.04em;
  --sc-tool-letter-spacing-data: -0.01em;

  /* Spacing */
  --sc-tool-space-0: 0;
  --sc-tool-space-1: 0.125rem; /* 2px */
  --sc-tool-space-2: 0.25rem;  /* 4px */
  --sc-tool-space-3: 0.375rem; /* 6px */
  --sc-tool-space-4: 0.5rem;   /* 8px */
  --sc-tool-space-5: 0.75rem;  /* 12px */
  --sc-tool-space-6: 1rem;     /* 16px */
  --sc-tool-space-7: 1.25rem;  /* 20px */
  --sc-tool-space-8: 1.5rem;   /* 24px */
  --sc-tool-space-9: 2rem;     /* 32px */
  --sc-tool-space-10: 2.5rem;  /* 40px */
  --sc-tool-space-11: 3rem;    /* 48px */

  /* Shape, borders, and elevation */
  --sc-tool-radius-0: 0;
  --sc-tool-radius-1: 0.25rem;  /* 4px */
  --sc-tool-radius-2: 0.5rem;   /* 8px */
  --sc-tool-radius-3: 0.75rem;  /* 12px */
  --sc-tool-radius-pill: 999px;
  --sc-tool-border-hairline: 1px;
  --sc-tool-border-emphasis: 2px;
  --sc-tool-shadow-1: 0 1px 0 rgb(255 255 255 / 5%), 0 8px 24px rgb(0 0 0 / 24%);
  --sc-tool-shadow-2: 0 1px 0 rgb(255 255 255 / 7%), 0 16px 48px rgb(0 0 0 / 36%);

  /* Motion */
  --sc-tool-duration-instant: 80ms;
  --sc-tool-duration-fast: 140ms;
  --sc-tool-duration-base: 200ms;
  --sc-tool-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --sc-tool-ease-exit: cubic-bezier(0.4, 0, 1, 1);
}

/* Admin default: standard operator density */
[data-sc-tool-density="standard"] {
  --sc-tool-density-control-height: 2.5rem; /* 40px */
  --sc-tool-density-control-pad-inline: var(--sc-tool-space-5);
  --sc-tool-density-row-height: 2.75rem;    /* 44px */
  --sc-tool-density-panel-gap: var(--sc-tool-space-6);
  --sc-tool-density-panel-pad: var(--sc-tool-space-6);
}

/* Show Studio default: compact authoring density */
[data-sc-tool-density="compact"] {
  --sc-tool-density-control-height: 2rem;   /* 32px visual control */
  --sc-tool-density-control-pad-inline: var(--sc-tool-space-4);
  --sc-tool-density-row-height: 2.25rem;    /* 36px */
  --sc-tool-density-panel-gap: var(--sc-tool-space-4);
  --sc-tool-density-panel-pad: var(--sc-tool-space-5);
}
```

The five `--sc-tool-density-*` properties are aliases, not optional additions. Admin
sets `data-sc-tool-density="standard"` on its root; Studio sets
`data-sc-tool-density="compact"`. A compact control still needs a 44 × 44 CSS-pixel
hit area on touch/coarse-pointer layouts, achieved with row spacing or an expanded hit
target rather than a visually taller control.

### Surface and cream usage

| Level | Token | Required use |
| --- | --- | --- |
| Canvas | `canvas` | App background and Studio graph canvas |
| Surface 1 | `surface-1` | Persistent chrome and Studio inspector/sidebar |
| Surface 2 | `surface-2` | Structural panels, table headers, form groups |
| Surface 3 | `surface-3` | Hover, selected rows, nested controls, raised node bodies |
| Cream text | `text` | Primary text on dark surfaces |
| Cream module | `cream-strong` | Empty-state feature tile or singular high-emphasis module |
| Cream action | `action` | One primary action per region |

Do not stack several cream modules in a dense work area. A cream module inverts to
`text-on-cream` and `text-muted-on-cream`; it does not contain a second cream-filled
button. Surface separation normally uses `rule`; interactive boundaries and meaningful
graph lines use `rule-strong` so they remain perceivable.

### Typography

Space Grotesk and IBM Plex Mono are intentional selections for this new direction, not
carryovers from an earlier visual system. Host them locally; use no Google Fonts import
and make no runtime font request to a third party. Asset URLs are relative to the
tools-owned stylesheet/package so Vite rewrites them correctly for both `/admin/` and
other configured bases. The implementation contract is:

```css
@font-face {
  font-family: "Space Grotesk";
  src: url("./fonts/space-grotesk-latin-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
}

@font-face {
  font-family: "IBM Plex Mono";
  src: url("./fonts/ibm-plex-mono-latin-400.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: "IBM Plex Mono";
  src: url("./fonts/ibm-plex-mono-latin-500.woff2") format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
}
```

- Space Grotesk is the UI and editorial face: app chrome, headings, labels, controls,
  and prose. Use 400–600; reserve 600 for headings and actions.
- IBM Plex Mono is for identifiers, timestamps, connection state, counts, shortcuts,
  validation codes, ports, and aligned numeric data. Use tabular numbers
  (`font-variant-numeric: tabular-nums`). It is not the default body face.
- Uppercase is limited to short labels at sizes `00` and `0`, with the label tracking
  token. Never uppercase sentences, error messages, or button labels.
- Body and control text must not be smaller than size `1` (13px). Size `00` is limited
  to supplementary labels that are not required to operate the interface.

### Border, radius, elevation, and motion

- Use one-pixel rules for layout and grouping; use two pixels for selected graph nodes,
  invalid controls, and focus-adjacent emphasis.
- Default controls and nodes use radius `1`; panels use radius `2`. Radius `3` is only
  for a bold cream module or modal. Pill radius is only for tags and status chips.
- Persistent regions are separated by rules, not shadows. Shadow `1` is for the Studio
  menu and dragged nodes; shadow `2` is for the confirmation dialog only.
- Animate opacity, color, border-color, and transform. Do not transition `all`.
- State changes use `fast`; panel or drawer movement uses `base`. No tool animation may
  exceed 200ms unless it directly represents progress.
- Under `prefers-reduced-motion: reduce`, remove nonessential transforms and set state
  transitions to `instant`. Spinners may remain if a text status is also present.

## 4. Density and layout

### Admin: standard density

Admin is scanned under pressure. Favor stable blocks, comfortable 40px controls, 44px
rows, plain-language labels, and a clear command hierarchy. The page header owns the
page title and global connection/system state. Operational facts come before commands.
Dangerous actions are visually separated and require confirmation where consequences
are not immediately reversible.

Recommended desktop frame: a flexible main column with clearly separated status,
controls, export, and recent-error panels. Content width is not artificially capped
when operational data needs room; prose sections cap at 72ch.

### Show Studio: compact density

Studio is an authoring workbench. Favor a continuous canvas, compact 32px controls,
36px rows, abbreviated technical metadata, and persistent validation visibility.
Compact density must not shrink headings, inspector form text, focus rings, or pointer
targets below the accessibility requirements.

Recommended desktop frame: 48px top toolbar, flexible graph canvas, 280–336px inspector,
and a 36–160px collapsible diagnostics region. The canvas is the spatial anchor;
toolbars and inspectors remain dark surfaces differentiated by rules.

## 5. Semantic and domain color

Semantic colors have fixed meanings:

- `info`: neutral system or connection information
- `success`: saved, connected, valid, or completed
- `warning`: degraded, incomplete, stale, or needing attention
- `danger`: invalid, failed, disconnected, or destructive

Show-domain colors identify graph concepts, not status:

- `domain-entry`: entry marker and valid forward flow
- `domain-idle`: idle/end markers and inactive paths
- `domain-video`: video node accent
- `domain-question`: position-question node accent
- `domain-branch`: conditional ports, tie/empty paths, and branching emphasis

Never use a domain color to imply success or failure. Use domain color on a 2–4px edge,
port, icon, or short label; node bodies remain in the surface hierarchy. Every colored
status or node kind also carries visible text or a non-color symbol. Avoid low-opacity
semantic text; use the solid tokens on dark surfaces.

## 6. Component rules

This section is intentionally finite. It covers the primitives consumed by current
Admin and Studio screens and must not be expanded merely to make a component catalog
look complete.

### Application shells

- Persistent chrome uses `surface-1` and a one-pixel `rule` boundary.
- Admin presents its token connection, operational status, controls, session export,
  and recent errors as a single scannable operator page.
- Studio presents project home/recent shows or the editor shell with top menu/toolbar,
  graph canvas, inspector, diagnostics, and preview.
- Page titles use size `5` in Admin and size `4` in Studio. Pair them with a concise
  status line, never a decorative subtitle.

### Buttons

- Primary: `action` background, `text-on-cream`, semibold label, radius `1`.
- Secondary: transparent or `surface-2`, `text`, and `rule-strong` border.
- Quiet: transparent, `text-secondary`; hover moves to `surface-3` and `text`.
- Danger: transparent with `danger` text and border. A final destructive confirmation
  may use `danger` fill with `text-on-cream` only after its contrast is tested.
- Studio's file-import label styled as a button follows button focus, disabled, and
  target rules while retaining a correctly labelled hidden file input.
- Graph control icon buttons require an accessible name and tooltip. Other button
  labels use explicit verbs.
- Disabled controls remain readable, expose native/ARIA disabled state, and cannot rely
  on opacity below 60%; explain blocked critical actions nearby.

### Text, password, and number fields; selects; checkboxes

- Labels sit above controls. Required state is stated in text, not only an asterisk.
- Text, password, and number fields and selects use `surface-1`, `text`, and
  `rule-strong`. Placeholder text uses `text-muted` and never substitutes for a label.
- Number fields retain native numeric semantics and declared minimums. Selects remain
  native unless a real flow later demonstrates a requirement they cannot meet.
- Checkboxes retain a visible native input, place the descriptive label beside it, and
  use at least a 24px combined label/input target. Do not restyle a checkbox as a switch.
- Help text precedes validation text. Errors use `danger`, an icon, and a specific
  recovery message; `aria-describedby` connects all supporting text.
- Focus uses a 2px outline with a 2px offset: `focus-on-dark` on `canvas` and
  `surface-*`, and `focus-on-cream` on `cream-strong`, `action`, `action-hover`, and
  `action-pressed`. Components that cross surface types must switch the token with the
  surface; do not remove focus or replace it solely with a border-color change.
- Group related fields with spacing and a rule; do not wrap every field in its own
  container.

### Structural panels, lists, and data tables

- Panels group existing operational status, controls, exports, errors, inspector fields,
  diagnostics, or preview content. They use `surface-2`, a rule, and radius `2`.
- The Studio recent-show list remains a semantic list of show records with open,
  duplicate, backup, and delete actions.
- Table headers use size `0`, medium weight, optional uppercase, and `surface-2`.
- Numeric values, timestamps, IDs, shortcuts, and machine state use IBM Plex Mono with
  tabular figures. Align numbers right and text left.
- Separate rows with hairline rules. Zebra striping is not part of this system.
- Only actionable Studio recent-show rows use `surface-3` on hover; diagnostics table
  rows do not imply selection.
- Truncation requires a way to reveal and copy the full value. Do not truncate the
  primary name if another column can yield first.

### Status and inline feedback

- Admin server/display/session status and Studio save/validation/export status use an
  explicit text label and—where useful—a semantic icon and mono value.
- Errors and validation feedback appear inline beside the affected field, graph item,
  diagnostics region, import/export action, or Admin connection control. Use an
  appropriate live region without moving focus or flooding repeated updates.
- Saving and validation retain persistent locations in Studio chrome.

### Studio menu

- The existing Studio dropdown menu uses `surface-3`, `rule-strong`, radius `2`, and
  shadow `1`; its trigger exposes expanded state and its menu items preserve compact row
  height. Arrow keys, Home/End, Escape, outside click, and focus return remain supported.

### Confirmation dialog

- Replace current `window.confirm` calls with one accessible confirmation-dialog
  primitive. Replace current `window.alert` calls with inline feedback when the message
  belongs to a field/action; use the dialog only when progress must be blocked.
- The dialog uses `surface-2`, radius `3`, shadow `2`, and a scrim. It has an accessible
  name and consequence description; focus is trapped, initial focus is deliberate,
  Escape closes when safe, and focus returns to the trigger.
- Confirm the concrete consequence, name the affected show or graph change, and make
  the safest action easiest to reach. Do not use “Are you sure?” as the only explanation.

### Studio graph

- Canvas uses `canvas`; optional grid marks use `rule` and must remain subordinate.
- Nodes use `surface-2`, radius `1`, a `rule-strong` border, and no resting shadow.
  Selected nodes use a 2px `action` border; dragged nodes use shadow `1`.
- Node type is shown by a domain-color top/left rule plus a text label. The node body is
  never fully flooded with a domain color.
- Ports are at least 12px visually and have a 24px pointer hit area. They carry labels;
  branch handles use stable position and order.
- Edges default to `rule-strong`. Valid active flow uses `domain-entry`; conditional
  paths use `domain-branch`; invalid edges use `danger` plus a dash or icon treatment.
- Existing zoom controls follow the same button, focus, and contrast rules as the rest
  of Studio.
- Inspector selection and canvas selection are synchronized. Validation points to and
  focuses the affected node or field without unexpected canvas movement.

## 7. Accessibility

The implementation target is WCAG 2.2 AA.

- Normal text meets at least 4.5:1; large text meets at least 3:1. Meaningful component
  boundaries, focus indicators, graph ports, and state graphics meet at least 3:1
  against adjacent colors.
- All operations are keyboard reachable in a logical order. Studio graph actions need
  keyboard alternatives for connecting, moving, selecting, deleting, and inspecting.
- Focus is never obscured by sticky toolbars, drawers, or dialogs. Focus appearance is
  at least a 2px perimeter-equivalent and has at least 3:1 contrast.
- Pointer targets are at least 24 × 24 CSS px and are not crowded. Primary touch targets
  and all controls under `pointer: coarse` are at least 44 × 44 CSS px.
- Do not encode state only through color, position, hover, or animation. Icons require
  text alternatives; decorative icons are hidden from assistive technology.
- Announce connection, save, validation, and export results without moving focus.
  Repeated high-frequency events must not flood live regions.
- Errors are summarized and linked to their fields; data tables retain correct headers
  and captions where needed.
- Text remains usable at 200% zoom and with browser text spacing overrides. Reflow must
  not require two-dimensional scrolling except for the Studio graph and genuine data
  tables; those regions need accessible names and keyboard scrolling.
- Forced-colors mode preserves boundaries, selection, focus, and status semantics.

### Contrast verification

The following pairs were checked programmatically with the WCAG relative-luminance
formula using the exact hex values in the token contract. Ratios are rounded to two
decimal places for display; conformance decisions must use unrounded results.

| Foreground on background | Ratio | AA use |
| --- | ---: | --- |
| `text` on `canvas` | 15.67:1 | All text |
| `text-secondary` on `canvas` | 10.04:1 | All text |
| `text-muted` on `canvas` | 6.97:1 | All text |
| `text` on `surface-3` | 11.91:1 | All text |
| `text-on-cream` on `action` | 13.71:1 | All text |
| `text-on-cream` on `cream-strong` | 15.92:1 | All text |
| `text-muted-on-cream` on `cream-strong` | 5.51:1 | Normal text |
| `focus-on-dark` on `surface-3` | 9.95:1 | Focus/UI graphics |
| `focus-on-cream` on `cream-strong` | 7.09:1 | Focus/UI graphics |
| `focus-on-cream` on `action` | 6.10:1 | Focus/UI graphics |
| `info` on `canvas` | 8.64:1 | Status text/graphics |
| `success` on `canvas` | 9.16:1 | Status text/graphics |
| `warning` on `canvas` | 10.17:1 | Status text/graphics |
| `danger` on `canvas` | 7.23:1 | Status text/graphics |
| `domain-entry` on `surface-3` | 7.00:1 | Domain text/graphics |
| `domain-idle` on `surface-3` | 5.92:1 | Domain text/graphics |
| `domain-video` on `surface-3` | 5.77:1 | Domain text/graphics |
| `domain-question` on `surface-3` | 6.65:1 | Domain text/graphics |
| `domain-branch` on `surface-3` | 6.28:1 | Domain text/graphics |
| `rule-strong` on `surface-3` | 3.16:1 | Meaningful boundaries |

`rule` is intentionally a subtle structural separator and must not be the sole visible
boundary of a control, state, port, or other meaningful graphical object. Use
`rule-strong` for those cases. Any new foreground/background pairing introduced during
implementation must be checked rather than inferred from this table.

## 8. Responsive behavior

Use content behavior, not device names, to choose breakpoints. Initial reference points:

- **At 1280px and above:** Admin may arrange status beside controls, exports, and recent
  errors. Studio uses canvas plus persistent inspector and diagnostics.
- **From 768px to 1279px:** Admin keeps the same section order in a narrower grid or
  single content column. Studio moves the inspector to a nonmodal drawer and collapses
  diagnostics to a resumable strip.
- **Below 768px:** Admin becomes one column with primary state before actions. Studio is
  a supported review/edit-details view: canvas, inspector, and diagnostics become
  separate full-width modes rather than three squeezed columns.

At every width:

- Preserve the current selection and unsaved edits when regions move or collapse.
- Keep the primary action and system/save status discoverable, but do not create two
  instances of the same interactive control in the accessibility tree.
- Allow genuine data tables and the graph canvas to scroll in their named region; keep
  the overall page from accidental horizontal overflow.
- Reposition the Studio menu within the viewport. Confirmation-dialog content scrolls
  internally while its title and actions remain reachable.
- Under coarse pointers, switch compact controls and graph tooling to 44px hit targets.

## 9. Implementation requirements

Phase 1 ends with this brief. It does not authorize CSS, component, font, application,
or package changes.

For the later implementation phase:

1. Scope shared assets and tokens to Admin and Studio only. No import path used by
   Display or Phone may acquire them transitively.
2. Add the specified local WOFF2 assets with their license notices, preload only the
   critical Space Grotesk file, and verify there are no third-party font requests.
3. Install the exact token contract once in a tools-owned stylesheet or package. App
   styles consume it; they do not maintain divergent copies.
4. Set the correct density attribute at each app root and migrate components by
   primitive/category rather than by isolated page restyling.
5. Preserve semantic HTML and native behavior before adding ARIA. Automated checks do
   not replace keyboard, zoom, screen-reader, forced-colors, and reduced-motion review.
6. Add representative visual regression coverage at wide, middle, and narrow layouts,
   including the default, focus, hover, disabled, error, selected, and confirmation
   states the products consume. Any visual fixtures or catalog cover only consumed
   primitives and representative Admin/Studio screens; completeness is not a goal.
7. Re-run contrast checks against rendered colors for every semantic/component pairing,
   including antialiasing-sensitive small text and any composited overlays.

## 10. Acceptance criteria

The design-system implementation is acceptable only when all of the following are true:

- Admin and Studio visibly share this neutral-charcoal/cream system while retaining their
  standard and compact densities respectively.
- No token, asset, font, gradient, component motif, or naming from abandoned
  explorations remains in either tool's rendered UI or tools-owned styles.
- `apps/display` and `apps/phone` have no visual, bundle, font-request, or dependency
  change caused by the tools system.
- Every shared CSS custom property uses the `--sc-tool-*` prefix and matches this
  contract; no app-local override changes its value.
- Space Grotesk and IBM Plex Mono load locally, use the documented roles, fall back
  safely, and cause no third-party request.
- Components follow the surface hierarchy, one-bold-action rule, and semantic/domain
  color separation documented here.
- Admin remains immediately scannable at standard density. Studio retains useful canvas
  space at compact density without reducing required target, text, or focus sizes.
- All required text, focus, boundary, and graphical-object contrast checks pass WCAG
  2.2 AA, including rendered states absent from the compact table above.
- Keyboard-only operation, visible focus, 200% zoom, text spacing, reduced motion,
  forced colors, coarse pointer targets, and responsive reflow pass manual review.
- Automated accessibility and visual-regression checks cover both tools at the three
  reference widths, with no serious accessibility violations.
- Admin connection/control/export failures and Studio saving, validation, import/export,
  graph selection, and confirmation states are explicit, labelled, and tested.
- Scenario compatibility, Admin operations, export behavior, and other existing product
  behavior remain unchanged except for the later approved presentation work.
