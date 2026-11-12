---
name: check-script-updates
description: Check a new revision of the human-written show script (a Google Doc, the "Ablauf") against the software and the current show — finds cues that need features we lack, says how existing features can realise the rest, lists text changes and voice recordings needed, and hands pure text changes to /update-show. Requires a Google Doc link. Use when asked to check, review or compare a new script version.
---

# Check script updates

The script is written by humans for humans: looser than code, but full of cues
saying what plays where. This skill turns one revision into two answers:

1. **Features:** does every cue have a way to happen in the show software?
2. **Text:** which scenes changed, and which need a new voice recording?

Steps 1–5 only **read**: the Google Doc, the repo, the Studio draft. Nothing is
edited, filed or published before the user decides in step 6.

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
share, copy or trash the doc.

## 2. Fetch and parse the script

1. `get_file_metadata` → record title, last modified time and modifier. This
   pins the revision you checked.
2. `download_file_content` with `exportMimeType: "text/html"`. Plain text
   **loses the colours**, and the colours carry most of the meaning. Copy the
   saved file into a new scratchpad folder.
3. `read_file_content` with `includeComments: true` for the open comment
   threads (questions and to-dos from the team). Large docs are saved to a
   file; read them with `jq`.
4. Parse the HTML export with the helper next to this file:

   ```bash
   python3 -I .claude/skills/check-script-updates/parse_script.py <export.html> <scratchpad>/parsed.json
   ```

   It outputs the legend paragraphs, every paragraph with colour-tagged runs
   and table row/column, and paragraphs grouped into scenes (`id`, `version`,
   `statuses`, `cues`).

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

## 3. Pin the baseline show

Find out what the script is being compared against, following `/update-show`
step 1–2 (read-only): a Studio backup file, or a PocketBase URL + draft. If
the user says "the live show", work out which draft is live; don't trust the
newest draft name. Write the untouched baseline to the scratchpad with
`exportBackup()`.

If the user also wants "what changed since the last script", fetch an earlier
revision with `list_file_revisions` + `download_file_content` (`revisionId`)
and parse it the same way. The Drive revision is what counts as "previous", not
your own memory of a past run.

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
- **Outside the software**: lighting desk, sound desk, staff, props. Note it,
  but don't propose code.

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
- **Black text that differs from the draft**: the draft or its recording is
  out of date. Check the media file version against the heading's `.vN`.
- **Version mismatch**: the script says `.v3`, the draft plays `.v2`.
- **Scenes in the script with no phase**, and **phases with no scene**: the
  show is missing scenes, or scenes were removed from the script.

Compare text after normalising whitespace and quotes. Strip the ElevenLabs
delivery tags (`[pause]`, `[calm]`, …) for the text comparison, but report
changed tags as a recording change.

## 6. Report and propose next steps

Write the full report to `<scratchpad>/script-check <doc title>.md` and give
the user its absolute path. In chat, give a short summary:

- Script revision checked (title, modified time) and the baseline (draft name +
  id + `updatedAt`, or backup path + SHA-256).
- **Features table:** cue → scene ID(s) → category → evidence → proposed next
  step. For *Missing*, propose the smallest change and whether it needs a
  native build. For *Possible by combining*, give the recipe.
- **Text changes** by scene ID, grouped as above, plus the **recordings to
  produce** (scene ID, new version).
- Open doc comments that affect either list.

Then decide what happens next, and **ask before acting**:

- **Only text/content changes, no missing features** → offer to run
  `/update-show` now. Pass on the baseline from step 3, the script revision (the
  HTML export in the scratchpad), and ask for the media folder holding any new
  recordings. Changed wording without its recording is a gap to report, not a
  text-only swap. Don't apply red text.
- **Missing features** → offer to file one GitHub issue per feature. Describe
  the behaviour; never paste script text. The user may still want the
  text-only scenes updated now; offer `/update-show` for those that don't depend
  on a missing feature.
- **Nothing changed** → say so, with the revision you checked.
