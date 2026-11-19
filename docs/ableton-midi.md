# Music in Ableton, cued by the show

The show's music runs in Ableton on the sound MacBook. The show server tells
Ableton what to do through the **MIDI bridge** (`apps/midi-bridge`): a small
program on the MacBook that listens to the server's cue feed (`GET /api/cues`)
and sends MIDI to Ableton through the Mac's built-in IAC Driver.

```
show server ──cue feed (internet/venue network)──▶ MIDI bridge ──IAC Driver──▶ Ableton
```

Ableton stays fully in the sound operator's hands: if a cue goes wrong, stop or
fade in Ableton. The bridge only presses buttons; it never takes control away.

## What sends MIDI

| Trigger | Set up in | Mapping file key |
| :- | :- | :- |
| A named cue when a scene starts | Studio → scene → Advanced settings → **External show cues** (comma separated, e.g. `musik-puls-start`) | `cues` |
| A scene starting, by scene ID | nothing in Studio | `scenes` |
| The show ending or restarting (back to idle) | nothing in Studio | `showEnd` |

Prefer named cues: they say what should happen (`musik-puls-lauter`) and keep
working when scenes are renamed or reordered. Scene IDs work without
republishing the show. Scenes in group paths fire too.

Cue names and scenes fire **once, when the scene starts**. When the bridge
(re)connects it learns the current scene but **does not replay** anything,
so a restart of the bridge never relaunches clips. A cue that fires while the
bridge is disconnected is missed: the operator then launches it by hand.

Scenes with synchronized phone audio start a few seconds after they are
announced (the phones' preparation time, 3 s by default). Their scene and cue
MIDI waits for that moment, timed on the server's clock, so music starts with
the video and not before it, the same way the lighting bridge times its looks.
If the announcement arrived later than events usually do, it waits that much
less. A scene skipped during the wait sends nothing.

## One-time setup on the MacBook

1. **Repo and Node:** Node 22 and pnpm 9 (`corepack enable`), then in this repo
   `pnpm install`. Use Terminal from the repo folder for every command below.
2. **IAC Driver:** open *Audio MIDI Setup* → *Window* → *Show MIDI Studio* →
   double-click **IAC Driver** → tick **Device is online**. Check with
   `pnpm midi-bridge --list-outputs` (should list `IAC Driver Bus 1`).
3. **Ableton:** *Settings* → *Link, Tempo & MIDI* → MIDI Ports → *In: IAC
   Driver (Bus 1)* → turn on **Remote** (and **Track** if you want to play
   instruments from it).
4. **Mapping file:** copy `apps/midi-bridge/midi-mapping.example.json` to
   `midi-mapping.json` in the repo folder (it is git-ignored: the cue list is
   show content) and edit it:

   ```json
   {
     "output": "IAC",
     "channel": 1,
     "cues":   { "musik-puls-start": [{ "note": 37 }], "musik-puls-lauter": [{ "cc": 20, "value": 110 }] },
     "scenes": { "T1-titel": [{ "note": 38 }] },
     "showEnd": [{ "note": 48 }]
   }
   ```

   Each entry is a list of MIDI messages, sent in order:
   - `{ "note": 60 }` — note on then off (optional `velocity`, `durationMs`, `channel`)
   - `{ "cc": 20, "value": 100 }` — control change (volume, filter, send …)
   - `{ "program": 3 }` — program change

   Channels are 1–16. The file reloads when you save it, even while the
   bridge runs; a broken edit is reported and the previous mapping kept.

## Mapping a cue in Ableton

1. In Ableton press **⌘M** (MIDI Map mode) and click the clip, scene launch
   button, Stop All Clips button, or fader the cue should control.
2. In Terminal send that cue once:
   `pnpm midi-bridge --test musik-puls-start`
3. Press **⌘M** again. Repeat per cue; `--test showEnd` sends the show-end entry.

Tip: launch whole **scenes** for music beds, map one note to **Stop All Clips**
for `showEnd`, and use CCs mapped to a track or return fader for "louder" and
"quieter" cues. Ableton's own fades and clip envelopes do the musical work.

## During the show

```bash
export SHOW_SERVER=https://<show server>
export DISPLAY_TOKEN=<the display token>   # same secret the main display uses
pnpm midi-bridge
```

Leave the Terminal window visible. Every scene, cue and MIDI message is logged
with the time. It says so when a cue has no mapping, when the server cannot be
reached (it keeps retrying), and stops with a clear message if the token is
wrong. `--dry-run` prints the MIDI instead of sending it.

The display token is a secret: don't put it in the mapping file or in git.

## Troubleshooting

- *No MIDI output matching "IAC"* — the IAC Driver is offline (step 2).
- *Ableton ignores the notes* — Remote is off for the IAC input (step 3), or the
  mapping was made on another channel.
- *cue "…" · not in the mapping file* — the name in Studio and in
  `midi-mapping.json` differ (they must match exactly).
- *cannot reach … · retrying* — network or server down; cues during the gap are
  missed, launch them by hand.
