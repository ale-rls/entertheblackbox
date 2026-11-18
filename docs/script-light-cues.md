# Light cues in the script

The stage light can be written into the script (the "Ablauf" Google Doc, or a
`.docx` of it), like text, video and music cues. The two script skills then put
it into the show: no code, and no hand-editing of the lighting file.

```
script (yellow "Licht:" cues + colour table)
  → /check-script-updates   checks every light cue against the show
  → /update-show            looks and scene triggers (with times) into lighting.json
  → lighting.json on the show laptop (the Studio draft needs nothing for the light)
  → show: scene starts → the bridge plays its look, or its steps at set times, on the desk
```

The Eos bridge and `lighting.json` are described in [eos-lighting.md](eos-lighting.md).

## The idea

A light state **stays until the next cue**, as on the desk. You do not write
the light for every scene, only a short cue where it should change. Colours are
defined once, in a table; each cue says which lamp gets which colour or level.

## The lamps

**L1–L4** are the four field lamps. Ln lights monitor field **Mn**: L1 is the
lamp of field M1, L2 of M2, and so on. `alle` means all four.

Which Eos channel each lamp is on lives in `lighting.json` on the show laptop
(`l1`–`l4`). The identify run on 2026-11-17 gave L1 = 11, L2 = 13, L3 = 12,
L4 = 10.

## 1. Define the colours once

A table anywhere in the doc whose header row names the lamp's emitters. The
first column is the colour's name; the other columns are 0–100. An empty cell
is 0. Columns that are not emitters (such as the monitor colour) are ignored.

| Name used in script | Red | Amber | Mint | Green | Blue | Monitor color (M1-4) |
| :- | -: | -: | -: | -: | -: | :- |
| Warm | 100 | 90 | 10 | 35 | 0 | #ffe0b0 |
| Kalt | 0 | 63 | 100 | 13 | 100 | #e0f0ff |

Emitters: `Red`/`Rot`, `Green`/`Grün`, `Blue`/`Blau`, `Amber`, `Mint`. Amber
and mint give warmer yellows and oranges than red/green/blue alone. The
names work in cues in any capitalisation.

## 2. Write the cue where the light changes

In the scene, in the **yellow** highlight (Licht / Bühne), one cue per line.
Square brackets around it are fine.

| Write | What happens when the scene starts |
| :- | :- |
| `Licht: L1+L3: Warm L2+L4: off` | L1 and L3 go to Warm at full, L2 and L4 go out. |
| `Licht: L1-L4: Kalt` | All four go to Kalt at full. |
| `Licht: 50% Warm auf L1-L4` | All four go to Warm at 50 %. |
| `Licht: L4+L1 Warm, L2+L3 off` | Same as with colons: groups can be separated by commas. |
| `L1-L4 Warm 100%` | A yellow line that starts with lamps needs no `Licht:`. |
| `Warm on lights 1-4` | Same as `Licht: L1-L4: Warm`. |
| `Licht: alle: off 3s` | All lamps fade out over 3 seconds. |

- **Lamps:** `L1`, `L1+L3`, `L1-L4`, `L1, L2`, or `alle`.
- **Settings:** a colour from the table, a level (`50%`, `0`–`100`), `on`/`an`
  (100) or `off`/`aus` (0), and optionally a fade (`2s`).
  - A colour alone switches the lamp on at full in that colour.
  - A level alone keeps the colour.
  - `off` keeps the colour for the next time the lamp comes on.
- **Fade:** 1 second unless the cue gives one; `0s` snaps.
- Lamps a cue doesn't mention **stay as they are**.

**Vote winner.** In a scene with a field vote, write in yellow:

> Die gewählte Gruppe wird durch Licht hervorgehoben. (andere drei Farben auf 25% Helligkeit)

When the vote is decided, the winning field's lamp goes to full and the others
to the level written there (25 % if none is given). A tie or an empty vote
changes nothing.

**Anything else** in yellow that mentions light, a lamp or a colour from the
table ("[LICHT: Saal hell]", "Licht wieder auf alle", "Flackern auf
L1-L4") is a note for the operator. It goes on their cue list; nothing is
automated, and nothing is dropped. To automate it, rewrite it as a `Licht:`
cue, e.g. `Licht: L1-L4: an`. Text after a comma that names no lamp
(`Licht: L1-4 off, Saal hell`) goes to the operator too, while the lamp
part is automated. A lamp line whose settings are a sentence ("L1+L2
markieren die vordere Zone") is a description, not a cue.

### Field grids: the four fields as a table

The script draws the four stage fields as a 2×2 table. The legend's grid says
where each field is:

| | |
| :- | :- |
| M3/L3 | M2/L2 |
| M4/L4 | M1/L1 |

A grid in a scene uses the same positions. Each cell is that field's
**monitor text**, optionally with its **colour**: in yellow (`M3: Antwort eins
(Warm)`) or in the label (`M3/L3 Warm: Antwort eins`). The labels `M3:`, `M3 `
or `M3/L3 …:` are optional, since the position decides the field; a label that
contradicts its position is reported.

- A grid **with colours** sets each field's lamp to its colour when the scene
  starts, and gives the monitors their answer colour (the colour table's
  monitor column).
- A grid **without colours** keeps the colours of the grid before it: the
  light doesn't change, and the monitors keep those colours.
- A grid of **numbers only** (such as the lamps' desk channels) is an
  instruction, not a cue.
- For a **vote winner** in a later scene, the field grid tells which answer
  is on which field, and so which lamp lights it.

### Which scene a cue belongs to

The skill takes the scene heading above the cue in the same table cell (also a
long heading such as "K1.7.v2 (war K1.6) Kopfhörer: …"). If the cell has no
heading, it takes the heading in the same table row (the other column), then
the last heading in the same column, then the last heading at all. If a cue
lands in the wrong scene, put it directly under the heading.

### When it fires

At the **start** of the scene, or for the vote winner, when the vote is
decided. Scenes with synchronized phone audio start a few seconds after they
are announced; the light waits for the real start.

Some script scenes run **inside** a longer show scene: a question round where
the show plays one long scene and the monitors switch to each question at a
set time. A cue in such a script scene fires at the moment its question
appears on the monitors. `/update-show` takes that time from the monitor cue
in the draft. If the monitor times change in Studio, run `/update-show` again
so the light follows.

A change at a moment the show doesn't mark ("after 10 s", "on the third
flash") cannot be automated yet: leave it as a note for the operator.

## 3. What the skills do

**`/check-script-updates`** lists every light cue with its scene and says, for
each one, whether it is already in the show, needs setting up, or is for the
operator. It reports colours that aren't in the table and lamps that don't
exist. It compares each field grid with the show's monitor texts and answer
colours for that scene.

**`/update-show`** (step 3b):

1. Matches each script scene to its scene in the show (`T2.2` → `T2-2-regie`).
2. For the vote winner, works out which vote answer is on which monitor field
   (and so which lamp). It asks when this is not clear.
3. Generates the lighting file and a report (`light-plan.md`): what fires
   automatically, the operator's cue list, and every problem. Each cue becomes
   a look named after what it does, e.g. `licht-l1-l3-warm-l2-l4-off`; the
   same cue in several scenes is one look.
4. Puts a scene trigger for each show scene into the lighting file: the look
   at its start, or timed steps for a scene that holds several script scenes.
   The Studio draft needs nothing for the light.
5. Checks the lighting file with the bridge itself and puts it on the show
   laptop after you confirm.

The bridge on the laptop picks up the new lighting file by itself. Because the
file only needs the script and the published show, it can be built on the show
laptop itself.

## What the script controls, and what it doesn't

The skill rebuilds from the script, on every update:

- the colours in the colour table,
- the `licht-…` looks and the scene triggers that use them, and the
  `gewinner-…` looks for votes.

A cue removed from the script is gone after the next update.

It does **not** change what belongs to the venue or was set up by hand in
`lighting.json`: the desk address, which lamp is on which Eos channel, the dim
curve, the show-end look, and any look, cue or vote entry that did not come
from the script. A colour in the script's table **replaces** a hand-made colour
with the same name.

## Limits

- Only lamps listed in `lighting.json` can be used: today the four field lamps
  L1–L4 (KL Fresnel 8 FC). House light, follow spots and other fixtures stay
  with the operator until they are added there.
- Cues set colour and level. Zoom, colour temperature and strobe stay at the
  lamp's setup in `lighting.json`.
- A lamp lights a field, not a person: "mark the chosen person with light" is
  an operator cue.
- Cues fire at a scene's start, at the time its question appears on the
  monitors, or at a vote result. If the operator skips ahead inside a scene,
  the light keeps to the scene's clock, as the monitors do.
- Stage 1: the looks live in `lighting.json` on the show laptop, not in the
  published show. Moving the light plan into Studio, published with the show
  and sharing its colours with the projection and monitors, is a later step.

## Troubleshooting

`light-plan.md` lists every problem with the scene and the exact text:

- *"…" is neither a colour, a level nor a fade*: a word in the cue is not in
  the colour table, a level such as `50%`, `on`/`off`, or a fade such as `2s`.
- *no lamp L5*: only L1–L4 (and `alle`) exist.
- *two light cues at the same moment*: two `Licht:` cues land on the same
  time of one show scene. Only the last one would show; keep one.
- *light cue but no phase for this scene*: the scene isn't matched to a scene
  in the show yet (the skill's mapping step).
- Operator notes: yellow light text that isn't a `Licht:` cue. It stays on
  the operator's list.
