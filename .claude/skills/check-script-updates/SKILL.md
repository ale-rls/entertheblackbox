---
name: check-script-updates
description: Check a new revision of the human-written show script (a Google Doc, the "Ablauf") against the software and the show live on the server — finds cues that need features we lack, says how existing features can realise the rest, lists text changes and voice recordings needed, and hands pure text changes to /update-show. Requires a Google Doc link. Use when asked to check, review or compare a new script version.
---

# Check script updates

The script is written by humans for humans: looser than code, but full of cues
saying what plays where. This skill turns one revision into two answers:

1. **Features:** does every cue have a way to happen in the show software?
2. **Text:** which scenes changed, and which need a new voice recording?

Steps 1–5 only **read**: the Google Doc, the repo, the live server's public
endpoints and the Studio drafts. Nothing is edited, filed or published before the user decides in step 6.

The script and everything derived from it is **show content**. Keep exports,
parsed JSON and reports in the scratchpad, never in this repository; don't
quote script text in issues, PRs or commits (this repo is public). Refer to
scenes by ID (`K3.1.2`) and describe cues in your own words.

## 1. Get the Google Doc link

A link is **required**. If the user didn't give one, ask for it and stop until
you have it; never reuse a link from memory or an earlier run without
confirming. Each run can use a different doc. Take the file ID from
`docs.google.com/document/d/<fileId>/...`.

Read through the **claude.ai Google Drive** connector. If its tools are
missing, ask the user to run `/mcp` and connect *claude.ai Google Drive*.
Use only the read tools (`get_file_metadata`, `read_file_content`,
`download_file_content`, `list_file_revisions`). Never edit, comment on,
share, copy or trash the doc. (Uploading generated voice cues to the VOX
folder happens later, in `/update-show`, never to the script doc.)

The show's recordings live in the Drive **VOX folder**
`1tUTMifql-T_wOdTxuTP8T2NrEuyGc6Rx`
(https://drive.google.com/drive/folders/1tUTMifql-T_wOdTxuTP8T2NrEuyGc6Rx).
Use it as the default media folder: list files newer than the baseline draft
(`search_files` with `parentId` and `modifiedTime`) instead of asking for one.

## 2. Fetch and parse the script

1. `get_file_metadata` → record title, last modified time and modifier. This
   pins the revision you checked.
2. `download_file_content` with `exportMimeType: "text/html"`. Plain text
   **loses the colours**, and the colours carry most of the meaning. Copy the
   saved file into a new scratchpad folder.
3. `read_file_content` with `includeComments: true` for the open comment
   threads (questions and to-dos from the team). Large docs are saved to a
   file; read them with `jq`.
4. Parse the HTML export with the helper next to this file. It also reads a
   `.docx` of the script directly (when the user hands over a Word file
   instead of the doc); highlights come out as the same colours.

   ```bash
   python3 -I .claude/skills/check-script-updates/parse_script.py <export.html | script.docx> <scratchpad>/parsed.json
   ```

   It outputs the legend paragraphs, every paragraph with colour-tagged runs
   and table row/column, and paragraphs grouped into scenes (`id`, `version`,
   `statuses`, `cues`). `versionedIds` lists every `ID.vN` heading,
   including the ones that share a paragraph with the previous scene. Use it for
   the recording check. `lightCues` and `lightColours` hold the light
   cues and the colour table written in the script's light notation (step 4).
   `fieldGrids` holds every 2×2 field grid: per field M1–M4 its monitor text,
   lamp and colour (step 4, monitors). `problems` lists grid labels that
   contradict the legend and colours not in the colour table: report them.
   Struck-through text is tagged `struck: true` on its runs; `struckScenes`
   lists scenes whose heading is struck through, and each scene has
   `struck` and `struckParagraphs`. Struck text is **cut** (step 5).

**Check the legend first.** The legend is at the top of the doc, before the first
table. If it no longer matches the mapping in `parse_script.py`, or
`unmappedColours` is not empty, trust the doc, tell the user and read those
runs by hand. The mapping as of 2026-11:

| Text colour | Meaning |
| :- | :- |
| black | final; the recording (Vox) exists in the media folder |
| red | content not revised yet — not ready for the show |
| purple | approved change; needs a new recording, and its version number goes up |
| light-green highlight on a heading | the section can go to voice production |
| ~~struck through~~ (any colour) | cut from the show; wins over the colour |

| Highlight | Cue type |
| :- | :- |
| green | Video (main projection / video curtain) |
| sage green | Monitore (M1–M4) |
| yellow | Licht / Bühne (light, stage, staff) |
| cyan | Musik |
| magenta | Code (show logic: timing, votes, triggers, loops) |

Scene IDs: `K…` = KI-Blackbox (headphones, native tablets on stage), `T…` =
Theater-Blackbox (audience, phones, main projection). A `.vN` suffix is the
recording version and should match the media file name. Headings like
`K1 — …` without a version are sections. Stage directions in `[...]` or italics
and timings ("Nach 60 Sekunden Pause", "[1:13]") are cues too.

## 3. Pin the live show and the baseline draft

Compare the script with **what's live on the server** by default, and with the
**latest Studio draft**. A draft can be edited after publishing, so these two
can differ. Everything here is read-only, uses public endpoints and needs no
operator sign-in. Default server: `https://bb-frontend.enabler.space`; ask if
the user means another one.

1. **Live release.** `GET /api/status`. Record `scenarioVersion`
   (`release-<uuid>`), `showLifecycle` and `scenarioWarnings`. Treat the
   warnings as findings: unreachable phases, or groups that finish
   immediately, often explain why a script cue doesn't happen.
2. **Live phases.** `GET /api/phases` gives phase ID → published media path. The
   path ends in the file's SHA-256 (`native-shows/assets/<sha256>.<ext>`).
   `GET /media-manifest.json` lists every published file with its `hash`.
   `GET /media/native-shows/channels/production.json` gives what native apps
   download: per-file `sha256`, background music, and its own
   `scenarioVersion`. Check that this matches step 1; if it doesn't, the apps
   and the server are out of step, so report it.
3. **Which draft is live.** The release doesn't name its source draft, and the
   newest draft name can mislead. List the drafts with
   `PocketbaseDraftDatabase.list()` (`apps/studio/src/pocketbase-drafts.ts`).
   Get library hashes (`src` → `hash`) with `PocketbaseMediaLibrary.list()`
   (`apps/studio/src/media/pocketbase-media.ts`). Run both against the Studio
   PocketBase URL: ask the user for it, or read it from the live `/studio/`
   bundle. For each candidate draft, map phase ID → media `src` → `hash` and
   compare with the live phases from step 2. This rules out old drafts, but
   it **can't separate close drafts**. `/api/phases` lists only phases that have
   media, so text-only, group-branch and narration-only phases aren't
   compared. Several recent drafts can match every live phase. Then run
   the decisive test: collect every hash the draft references (any string in
   the draft that is a library `src`) and check that **every live file** (all
   `media-manifest.json` hashes, all native channel `sha256`s and the background
   music) is among them. The live draft has zero live files missing. Ignore
   files that are only in the draft: drafts reference plenty of unused library
   media, so that count is noise. Tested 2026-11-12: two drafts matched all 32
   live phases, but only one contained all 97 live files. The other, newer one,
   was missing 24 and was not live.
   If no draft has zero missing, report the closest one and every missing
   file, and don't guess. Caveat: the library keeps only the current hash per
   `src`, so a file replaced under the same name after publishing shows up as
   missing.
4. **Draft vs live.** If the newest draft isn't the live one, diff the two
   (phases added/removed, transitions, media, narration text). These are
   unpublished edits that are already waiting, so don't report them as script
   changes still to do.

Write both untouched baselines (the live draft and the newest draft, if they
differ) to the scratchpad with `exportBackup()`. If the user gives a backup
file instead, use it as the baseline and still run steps 1–2, so the report
says whether that file is what's live.

The script's text is compared with the **live draft's** narration (the public
endpoints carry media, not text). Media versions are checked against the
**live hashes**.

**Earlier script revisions can't be downloaded.** `list_file_revisions` lists
them, but `download_file_content` with a `revisionId` is not supported (tested
2026-11-12). So the comparison is script vs show, which is what matters. For
"what changed in the script since the show was built", compare `modifiedTime`
with the live draft's `updatedAt` and rely on the purple text.

## 4. Features: map every cue onto the software

Go through every scene and cue (highlighted runs, stage directions, `Code`
notes, open comments). For each, decide which of these it is, with evidence:

- **Exists, already set up**: the baseline draft does it (name the phase ID and
  the field).
- **Exists, needs setting up**: the software supports it, the draft doesn't do
  it yet. That is content work for `/update-show`.
- **Possible by combining features**: no direct feature, but a combination works
  (e.g. a still + silent MP3 hold, a membership-only split plus
  `phoneAudioByGroup`, a participant task with capped roles). Describe the
  combination and what it gives up.
- **Missing**: needs code. Say which app/package it touches (see the
  dependency map in FEATURES.md) and whether the native app would need an EAS
  Update or a new build.
- **Outside the software**: sound desk, staff, props, and light the Eos bridge
  can't do (see below). Note it, but don't propose code.

**Cursor votes are always curtain light (director decision 2026-11-21).**
Whenever the script uses cursor voting (theater phones steering cursors onto
fields), the vote is drawn as **curtain light**: the glowing cursors on the
curtain video, never the plain white-dot field overlay. This applies on the
closed **and** the open curtain (Teil 2, Act 2 votes). See
[curtain-light-voting.md](../../../docs/curtain-light-voting.md).

- On a group's own path, the group has *Curtain-light cursor votes* ticked; on
  the shared timeline, the phase has `curtainLightVote: true`. A cursor vote
  without either is **Exists, needs setting up**: list its phase ID.
- A curtain-light vote needs the shared curtain video and an unlit gap
  between its zones (zones that tile the screen fail validation).
- Curtain light replaces the scene's picture with the curtain while the vote
  runs. On the open curtain this hides the stage (e.g. the KI side on the
  coloured fields); report it as a consequence, but don't untick it.
- Spotlights can't be combined with curtain light (schema rule). A script cue
  asking for both is a conflict: report it and ask.

**Light cues — paused for now (director decision 2026-11-20).** Don't
classify the yellow `Licht` cues or `lightCues`, don't read `lighting.json`, and
leave lights out of the features table and the next steps. Say in one line
that light cues were not checked. Field grids are still checked for monitor
texts and answer order (below). The rules that follow stay for when lights are
switched back on.

**Light cues (when active).** The Eos bridge plays light looks on the venue desk from scene
starts, scene cue names and vote results (docs/eos-lighting.md). The script
writes them in the yellow highlight, listed in `lightCues`
([docs/script-light-cues.md](../../../docs/script-light-cues.md)):

- kind `set` (`Licht: L1+L3: Warm L2+L4: off`, `Licht: 50% Warm auf L1-L4`):
  lamps L1–L4 (the lamps of monitor fields M1–M4) with a colour from the
  colour table, a level or `off`. **Exists, needs setting up** if every colour
  is in the colour table (`lightColours`) or `lighting.json` and every lamp is
  L1–L4; otherwise report the unknown colour or lamp. **Already set up** if
  `lighting.json` already plays the matching `licht-…` look for that scene
  (`scenes`, at its start or at the time its question appears on the
  monitors). A script scene with no phase of its own (a question inside a
  longer scene) is fine: `/update-show` times it to its monitor cue.
  A field grid with its own colours is a `set` cue too (`source: "grid"`).
- kind `winner` ("Die gewählte Gruppe wird durch Licht hervorgehoben (andere …
  auf 25% …)"): needs a vote in that scene; note which answer is on which
  monitor field (Mn is lit by Ln), since `/update-show` needs it. Monitor N
  shows the vote's Nth answer in outcome order (zone order), so answer N is
  lit by lamp N; check it against the grid's texts (`fieldGrids`) and the
  zone labels. Ask if they disagree.
- kind `prose`: any other yellow line about light. It goes on the operator's
  list. Say it could be automated if rewritten as a `Licht: L…: …` cue (only
  for the four field lamps the bridge drives; house light, follow spots and
  other lamps not patched in `lighting.json` stay with the operator).

**Monitors (field grids).** For each grid in `fieldGrids`, find the phase
of its scene and compare: each field's `text` with that monitor's text cue in
`monitorCues` (images: open them and read the text), and each field's colour
with the phase's `answerColors` for the answer shown on that monitor (the
colour table's "Monitor color" column). A grid with `colours: "carried"` keeps
the colours of the grid at `coloursFrom`. Report text or colour that differs
as **Exists, needs setting up**. Grids inside a longer scene (a question
round) are the monitor cues that `/update-show` times the light to.

**Monitors (every cue).** The script also writes monitor cues outside grids:
`[Monitore M1–M4]: …` lines, `Farben Monitore` notes with one colour per
monitor or pair (e.g. "M1-3 <colour>"), a section-wide colour rule ("all
monitor colours in this part are …"), "then:" steps, `Countdown` /
"Countdown: N Sekunden" / "Countdown mit kleiner Text", and "Monitore … auf
weiß". The parser does not turn these into colours (`colour` stays `null`),
so read them in `paragraphs`. List every monitor cue up to the end of the
scope with phase, start time, kind, text, `color` and countdown fields, and
compare with the script. What the software can do (confirm in
`packages/scenario/src/monitors.ts` and `apps/display/src/monitors/`):

- **Colour.** Text, placeholder, vote-result and image-caption cues take
  `color` (`#rrggbb`); it wins over everything else. Without it: the
  vote-result's winner colour, else the phase's Nth answer colour during a
  vote, else white. A colour note on a non-vote scene is **Exists, needs
  setting up** (per-cue `color`), not a missing feature. Presets
  (`MONITOR_TEXT_COLOR_PRESETS`): white `#ffffff`, orange `#f76b15`, green
  `#30a46c`, blue `#3e63dd`, red `#e5484d`, yellow `#f5d90a`. In a vote scene,
  "white" needs an explicit `#ffffff`, or the answer colours apply.
- **Countdown.** Vote and scene countdowns show only their **last 5 s** on
  the monitors. A longer one ("Countdown: 30 Sekunden") needs
  `countdownSeconds` on the cue plus an end: the next cue's start or
  `durationMs` (a cue with neither never counts down; `durationMs` leaves the
  screen black after it, so prefer a following cue). "mit kleiner Text" is
  `countdownShowsText`. **Image and video cues never count down**: a question
  shown as a PNG loses its countdown, so report it.
- **Text instead of images.** Pre-rendered PNGs of text were the old way to
  get colour. Report them as **Exists, needs setting up**: replace them with
  text cues (open the images to read the text and colour).
- **"then:" steps.** First the question on all four monitors, then the split
  (labels on one pair, the question on the other). Check that the live cues
  have both steps.
- **Timing.** Cue times are milliseconds on the phase clock. To check when a
  question or scale is spoken, transcribe the phase's headphone audio
  (`phoneAudioByGroup` / `phoneAudioSrc`) with ElevenLabs STT
  (`scribe_v1`, `timestamps_granularity=word`) and compare. A cue sequence
  can run across several consecutive phases; follow it through `next`. Also
  report black gaps (a blank cue, or a phase with no cues) between cues that
  belong together, and a countdown that runs out too fast (e.g. at the
  start of an operator-paced phase).
- **Things monitors can't follow:** cues tied to manual, unscheduled actions
  (e.g. one countdown per field the operator lights by hand). Report them as
  **Missing** or as needing fixed times, and ask.

Where to check, in order: [FEATURES.md](../../../FEATURES.md); the
"Authoring a show" gotchas in [CLAUDE.md](../../../CLAUDE.md) (late joiners,
black main display during group paths, self-select waits for everyone,
duration rules); `packages/scenario/src/` for what the schema allows; and
the docs it links (group-branching, participant-workflows, monitor-displays,
curtain-light-voting, actor-script). **Confirm in code** (grep the schema and
the server) before calling anything "exists" or "missing": FEATURES.md can be
stale. Look for related issues (`gh issue list --state all --search ...`) and
open PRs, so you link existing work instead of proposing duplicates.

Watch for cues that sound simple but conflict with a gotcha. "The first two to
press yes" needs task role capacity, not a self-select split. Anything people
who join late must see belongs on the shared timeline.

## 5. Text: compare scenes with the show

For each scene with recorded text, match it to a baseline phase. Use the phase
ID first. Otherwise use the media file name, which carries the scene ID and
`.vN`, or the narration text. Then report:

- **Purple text**: approved change. Needs a new recording at version N+1. Show
  the old and new wording side by side (scratchpad report only).
- **Light-green heading**: ready to be recorded. List as recordings to produce.
- **Red text**: not final. Report it, but don't put it in the show.
- **Struck-through text** (`struckScenes`, runs with `struck`): cut. A struck
  scene that the show still plays must be **removed** from the draft (its
  audio, text or phase), never re-recorded. Struck lines inside a scene that
  stays mean the recording needs a new version without them. Struck text in
  the archive section after the running order doesn't count.
- **Black text that differs from the draft**: the draft or its recording is
  out of date. Check the media file version against the heading's `.vN`.
- **Version mismatch**: the script says `.v3`, the draft plays `.v2`.
- **Scenes in the script with no phase**, and **phases with no scene**: the
  show is missing scenes, or scenes were removed from the script.

Compare text after normalising whitespace and quotes. Strip the ElevenLabs
delivery tags (`[pause]`, `[calm]`, …) for the text comparison, but report
changed tags as a recording change.

**Sample rate (director requirement, 2026-11-20 — very important).** **All
audio** must be **48 kHz**. List every audio file the baseline plays: the
room (each phase's `audioSrc`, `extraAudioSrc`, main-display videos with a
soundtrack) and the headphones (`phoneAudioSrc`, `phoneAudioByGroup`, task
outcome audio, background music). Probe each straight from its library
`previewUrl`:
`ffprobe -v error -select_streams a -show_entries stream=codec_name,sample_rate -of csv=p=0 <url>`.
Report every file that isn't `48000` (scene, side, file, rate) as **needs
re-encoding**, separately from the text changes; `/update-show` resamples
the ones it touches and makes all new cues at 48 kHz. Videos without an
audio stream don't count. Tested 2026-11-20: every theater MP3 and three
videos were still 44.1 kHz; the KI sync files were already 48 kHz.

## 6. Report and propose next steps

Write the full report to `<scratchpad>/script-check <doc title>.md` and give
the user its absolute path. In chat, give a short summary:

- Script revision checked (title, modified time).
- **Live show:** `scenarioVersion`, lifecycle, the matched draft (name + id +
  `updatedAt`, or "no exact match" with the differences), the native channel's
  `scenarioVersion`, and the server's `scenarioWarnings`.
- **Draft vs live:** unpublished edits in the newest draft, if any.
- Three comparisons, kept apart: **script vs live**, **script vs newest
  draft**, **draft vs live**.
- **Features table:** cue → scene ID(s) → category → evidence → proposed next
  step. For *Missing*, propose the smallest change and whether it needs a
  native build. For *Possible by combining*, give the recipe.
- **Text changes** by scene ID, grouped as above, plus the **recordings to
  produce** (scene ID, new version).
- Open doc comments that affect either list.

Then decide what happens next, and **ask before acting**:

- **Light cues** → paused; not part of the next steps for now.
- **Only text/content changes, no missing features** → offer to run
  `/update-show` now. Monitor fixes (text, colours, timing, countdowns) count
  as content: pass the monitor findings with phase IDs and cue times; it
  applies them in its step 3c. Pass on the baseline from step 3 (the newest draft if it
  already holds wanted unpublished edits; otherwise the live draft; ask if
  unclear), the script revision (the
  HTML export in the scratchpad, plus the doc ID and `modifiedTime` so
  `/update-show` can re-check the doc right before delivering), and the VOX
  folder as the media folder (ask only if the user has new recordings
  elsewhere). Voice cues still missing after that are **always generated**
  with ElevenLabs and uploaded to the library and the Drive VOX folder, as
  described in `/update-show` step 3a; never make a text-only swap. Don't apply
  red text.
- **Missing features** → offer to file one GitHub issue per feature. Describe
  the behaviour; never paste script text. The user may still want the
  text-only scenes updated now; offer `/update-show` for those that don't depend
  on a missing feature.
- **Nothing changed** → say so, with the revision you checked.
