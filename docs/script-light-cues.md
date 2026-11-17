# Light cues in the script

The stage light can be written into the script (the "Ablauf" Google Doc), like
text, video and music cues. The two script skills then put it into the show: no
code, and no hand-editing of the lighting file.

```
script (yellow LICHT cues + Lichtstimmung table)
  → /check-script-updates   checks every light cue against the show
  → /update-show            scene cue names into the Studio draft, looks into lighting.json
  → operator publishes the draft in Studio
  → show: scene starts → server sends the cue → Eos bridge plays the look on the desk
```

The Eos bridge and `lighting.json` are described in [eos-lighting.md](eos-lighting.md).

## The idea

A light state **stays until the next cue**, as on the desk. You do not write a
colour for every scene, only a short cue where the light should change. What
each look does is written once, in a table.

## 1. Define the looks once

Add a table anywhere in the doc below the colour legend (the top or the end both
work). Its first cell reads `Lichtstimmung`; the header row is not read.

| Lichtstimmung | Lampen | Fade |
| :- | :- | :- |
| vier felder | Feld rot: rot 100 · Feld blau: blau 100 · Feld grün: grün 100 · Feld gelb: gelb 100 | 2 |
| gedimmt | alle: 40 | 0 |
| aus | alle: aus | 3 |
| abend | alle: abend 20 | 6 |

- **Lichtstimmung:** the look's name. Spaces and umlauts are fine (also in colour names): in cues,
  `vier felder` is written `vier-felder`.
- **Lampen:** `lamp: setting`, separated by `·`, `;` or new lines.
  - `alle` is every lamp. It is applied first; lamps named after it override it.
  - Lamp names are the lamps in `lighting.json`, written naturally:
    `Feld grün` is the lamp `feld-gruen`.
  - A setting is a colour and/or a level. Colours: a palette name (`rot`,
    `blau`, `grün`, `gelb`, …, see below) or `#rrggbb`. Level: 0–100; `aus` is 0,
    `an` or `voll` is 100.
  - Anything a look leaves out **stays as it is**. `alle: 40` dims every lamp
    and keeps the colours; `Feld rot: blau` turns that lamp blue at its current
    level.
- **Fade:** seconds. Empty snaps.

**New colours** (optional) go in a second table whose first cell reads
`Lichtfarbe`. The mix uses the lamps' emitters, each 0–100: `rot`, `grün`,
`blau`, `amber`, `mint`. Amber and mint give warmer yellows and oranges than
red/green/blue alone. `#rrggbb` works too.

| Lichtfarbe | Mischung |
| :- | :- |
| abend | rot 100 · grün 30 · amber 80 |

## 2. Write the cue where the light changes

In the scene, in the **yellow** highlight (Licht / Bühne), exactly in one of
these forms. Square brackets around it are fine.

| Write | What happens |
| :- | :- |
| `LICHT: vier-felder` | When this scene starts, the look `vier-felder` plays. |
| `LICHT Gewinner` | When this scene's vote is decided, the lamp of the winning field goes to full and the others to 10 %. A tie or an empty vote changes nothing. |
| `LICHT Pult: kurzer Blitz auf die Bühne` | The operator does this on the desk. It goes on their cue list; nothing is automated. |

`LICHT` is written in capitals, followed by a colon or `Gewinner`/`Pult`. The
look name is one word (join words with `-`).

### Which scene a cue belongs to

The skill takes the scene heading above the cue in the same table cell. If the
cell has no heading, it takes the heading in the same table row (the other
column), then the last heading in the same column, then the last heading at
all. If a cue lands in the wrong scene, put it directly under the heading.

### When it fires

At the **start** of the scene, or for `LICHT Gewinner`, when the vote is
decided. The script is already split into short scenes ("Freeze" is a scene of
its own), so a cue at the start of a scene is usually the right moment.
Scenes with synchronized phone audio start a few seconds after they are
announced; the light waits for the real start.

A change in the **middle** of a scene ("after 10 s", "on the third flash")
cannot be automated yet: write it as `LICHT Pult: …` for the operator, or split
the scene.

## 3. What the skills do

**`/check-script-updates`** lists every light cue with its scene and says, for
each one, whether it is already in the show, needs setting up, or is for the
operator. It reports looks that are used but not in the table, lamps or colours
that don't exist, and light directions written as prose (for example
"[LICHT: Zuschauerraum hell …]"). Prose stays a note for the operator; it could
be automated if rewritten as `LICHT: <look>`.

**`/update-show`** (step 3b):

1. Matches each script scene to its scene in the show (`T2.2` → `T2-2-regie`).
2. For `LICHT Gewinner`, works out which vote answer is which field, from the
   scene's answers and their colours in the draft and the field colours in the
   script. It asks when this is not clear.
3. Generates the lighting file and a report (`light-plan.md`): what fires
   automatically, the operator's cue list, and every problem.
4. Adds a cue name `licht-<look>` to each scene in the new Studio draft
   (Advanced settings → External show cues). Other cue names there (MIDI,
   TouchDesigner) are left alone.
5. Checks the lighting file with the bridge itself and puts it on the show
   laptop after you confirm.

The operator then publishes the draft in Studio as usual. The bridge on the
laptop picks up the new lighting file by itself.

## What the script controls, and what it doesn't

The skill rebuilds from the script, on every update:

- the looks in the `Lichtstimmung` table and the colours in the `Lichtfarbe`
  table,
- the `licht-…` scene cues and the `gewinner-…` looks for votes.

A cue removed from the script is gone after the next update.

It does **not** change what belongs to the venue or was set up by hand in
`lighting.json`: the desk address, which lamp is on which Eos channel, the dim
curve, the show-end look, and any look, cue or vote entry that did not come
from the script. A look in the script's table **replaces** a hand-made look
with the same name.

## Limits

- Only lamps listed in `lighting.json` can be used: today the four field lamps
  (KL Fresnel, Eos channels 10–13). House light, follow spots and other
  fixtures stay with the operator until they are added there.
- A lamp lights a field, not a person: "mark the chosen person with light" is
  an operator cue.
- Cues fire at scene start or at a vote result, not in the middle of a scene.
- Stage 1: the looks live in `lighting.json` on the show laptop, not in the
  published show. Moving the light plan into Studio, published with the show
  and sharing its colours with the projection and monitors, is a later step.

## Troubleshooting

`light-plan.md` lists every problem with the scene and the exact text:

- *no Lichtstimmung of that name*: the cue's look is not in the table, or is
  spelled differently (`vier-felder` in the cue, `vier felder` in the table).
- *no lamp "…"*: the lamp name doesn't match `lighting.json`. The message lists
  the lamps that exist.
- *neither a colour nor a level*: a word in the Lampen cell is not a palette
  colour, `#rrggbb` or a number.
- *several light looks at the same scene start*: two `LICHT:` cues in one
  scene. Only the last one would show; keep one.
- *written as prose*: a light direction not in one of the forms above. It stays
  on the operator's list.
