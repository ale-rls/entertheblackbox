# Stage light from the show: the Eos bridge

The stage lamps hang off the venue's ETC Eos desk (Nomad on a Windows PC). The
show server tells the desk what to do through the **Eos bridge**
(`apps/eos-bridge`): a small program on the Nomad PC itself (see
[Running on the Nomad PC](#running-on-the-nomad-pc)) or on a laptop cabled to it. It
listens to the server's cue feed (`GET /api/cues`) and plays **looks** on the
desk over OSC.

```
show server ──cue feed (internet/venue network)──▶ Eos bridge (laptop) ──OSC over TCP──▶ Eos/Nomad ──sACN──▶ DMX box ──▶ lamps
```

The desk stays in the lighting operator's hands. The bridge acts as Eos user 0
(the background user), so it never touches the operator's command line, and the
operator can override any lamp at any time.

Colours, looks and what triggers them live in one JSON file, `lighting.json`.
Edit it and save. The running bridge reloads it; no code changes and no restart.

## The lighting file

Copy `apps/eos-bridge/lighting.example.json` to `lighting.json` in the repo
folder. It is git-ignored, because the looks and cue names are show content.

```json
{
  "eos": { "host": "169.254.126.220" },
  "fixtures": {
    "l1": { "channel": 11, "setup": { "intensity mspeed": -3 } }
  },
  "palette": {
    "rot":  { "red": 100 },
    "gelb": { "red": 100, "green": 55, "amber": 100 },
    "weiss": "#ffffff"
  },
  "looks": {
    "aus":     { "fade": 3,   "fixtures": { "*": { "level": 0 } } },
    "nur-l1":  { "fade": 1.5, "fixtures": { "*": { "level": 10 }, "l1": { "level": 100 } } }
  },
  "cues":    { "licht-aus": "aus" },
  "scenes":  { "T1-titel": "aus" },
  "results": { "T1-wahl": { "q1": "nur-l1", "none": "aus" } },
  "showEnd": "aus"
}
```

| Section | What it is |
| :- | :- |
| `eos` | The desk's IP address. `port` (3037) and `user` (0) rarely change. |
| `fixtures` | A name for each lamp and its **Eos channel number**. The script calls the field lamps L1–L4 (the lamp of monitor field M1–M4), so they are named `l1`–`l4` here. `setup` is sent on every connect, and again when a save changes it; `"intensity mspeed": -3` is the Theatre dim curve, `-7` is Standard. Intensity and the colour emitters belong to the looks and are refused in `setup`. |
| `palette` | Named colours. Either `"#rrggbb"`, or the lamp's emitters directly: `red`, `green`, `blue`, `amber`, `mint`, each 0–100 (missing ones are 0). Use the emitter form for yellows, oranges and warm tones: hex can only use red, green and blue. |
| `looks` | What each lamp does: `color` (a palette name or `#rrggbb`) and/or `level` (0–100). `"*"` applies to every lamp first; named lamps then override it. Anything left out stays as it is, so a highlight look can change levels and keep the colours. `fade` is in seconds. |
| `cues` | A named cue from Studio → look. |
| `scenes` | A scene ID → look, when that scene starts. Or → timed steps, `[{ "at": 0, "look": "a" }, { "at": 125.4, "look": "b" }]`: each look at that many seconds into the scene, counted from its real start on the server's clock, as monitor cues are. A new scene drops the steps still to come; a bridge (re)started mid-scene runs the ones still ahead and replays none. |
| `results` | A scene ID → vote winner → look, when that scene's vote resolves. Winners are `q1`–`q4` for four fields, `min`/`max` for two, or a zone ID for curtain-light zones. A question with a fixed next scene still lights the field the audience chose. When no field won, the server reports `tie` or `empty` (nobody voted), and `fixed` for a fixed next scene without a clear winner: give any of them its own look, or use `none` for all three. A field without its own entry keeps the current light. |
| `showEnd` | A look for when the show ends or is restarted. |

A broken edit is reported in the bridge's window and the previous file is
kept. Changing `eos.host`, `port` or `user` and saving makes the running bridge
reconnect to the new desk address (`--host` on the command line wins over the
file). Names must match: a cue pointing at a look that does not exist, or a look
using a colour that is not in the palette, is refused with the exact place.

### Triggers

| Trigger | Set up in | Lighting file key |
| :- | :- | :- |
| A named cue when a scene starts | Studio → scene → Advanced settings → **External show cues** (e.g. `licht-vier-felder`) | `cues` |
| A scene starting, by scene ID, or set times within it | nothing in Studio | `scenes` |
| A vote resolving, by scene ID and winner | nothing in Studio | `results` |
| The show ending or restarting | nothing in Studio | `showEnd` |

Prefer named cues for scene-start looks: they say what should happen and keep
working when scenes are renamed. They are shared with the MIDI bridge, so one
cue can start music and light together; each bridge ignores names it has no
entry for (it logs them).

Scenes with synchronized phone audio start a few seconds after they are
announced (the phones' preparation time, 3 s by default). The scene's look and
its cues wait for that moment, timed on the server's clock, so the light
changes with the video, not before it. If the announcement reached the laptop
later than events usually do, it waits that much less. The look is fixed when
the scene is announced: saving the lighting file during the wait does not
change or lose it. The waiting look is dropped if the
scene is over before it starts: the operator skips on, a group branch is
reunited (any new scene on the main timeline ends every group's timeline, also
when the operator forces the reunion), the show ends, or the bridge reconnects
and finds another scene running. On reconnect, a group scene the server still
lists from before main's current scene counts as over.

Like the MIDI bridge, triggers fire **once, live**. When the bridge
(re)connects it learns the current scene but **does not replay** anything. A
cue that fires while the bridge is disconnected is missed: the operator sets
that look on the desk.

### Fades

The bridge fades from what it last sent, about 30 updates a second. Right after
it starts it does not know what the desk shows, so its **first look snaps**;
every later look fades. The same happens after the desk connection drops:
messages sent just before the drop may never have arrived, so the bridge stops
trusting its memory and the next look snaps to the right values instead of
fading from a level the desk never showed. When the desk is back, the bridge
sends the current look again in one step, so a fade cut off by the drop, or a
look that fired while the desk was away, still ends where it should (this also
overrides anything changed by hand on those lamps meanwhile). If the desk stops
reading while the connection stays open (Nomad hanging), the bridge skips light
changes instead of piling them up, and sends the current look once the desk
catches up. A new look interrupts a running fade from wherever the
fade had got to. The lamps' own dim curve (`setup` above) shapes how smooth the
steps look.

## Light cues in the script

Looks and cues can be written in the script and put into the show by the
script skills, instead of editing this file by hand. How to write them and what
the skills do: [script-light-cues.md](script-light-cues.md).

## Setting up a laptop instead

1. **Repo and Node:** Node 22 and pnpm 9 (`corepack enable`), then
   `pnpm install` in this repo. Run every command below from the repo folder.
2. **Cable:** an Ethernet cable from the laptop to the Nomad PC (or both on the
   same switch). The desk's DMX box must stay connected: if the laptop takes the
   box's port, the lamps go dark. Use a small switch.
3. **The desk's address:** the PC and laptop pick addresses on their own when
   cabled directly (`169.254.x.x`), and they can change when a cable is
   replugged. Put the desk's address in `eos.host` and check it:
   `pnpm eos-bridge --ping`. For shows, give both machines fixed addresses.
4. **Nothing to set on the desk.** Eos's built-in OSC over TCP (port 3037) is
   used; the OSC settings in Setup and the Windows firewall stay as they are.

## Running on the Nomad PC

The bridge can run on the Windows PC that runs Eos/Nomad, with nothing
installed there: no Node, no pnpm, no repo, no admin rights. That saves the
laptop and the cable, and the desk is always at `127.0.0.1`.

On a machine with the repo (Mac or Windows), build the portable folder:

```bash
pnpm eos-bridge:windows                              # includes ./lighting.json if there is one
pnpm eos-bridge:windows --lighting path/to/lighting.json
```

It writes `dist/eos-bridge-windows/` and `dist/eos-bridge-windows.zip`: the
official Node.js for Windows (`node\node.exe`, downloaded from nodejs.org and
checked against a pinned SHA-256), the bridge bundled into one file
(`eos-bridge.mjs`) and double-click launchers. The zip contains no secrets;
it may contain the show's `lighting.json`, so don't share it publicly.

On the PC, unzip it (e.g. to the Desktop), then:

1. Start Nomad, then double-click **Ping desk.cmd**: it should say *desk answered*.
2. Double-click **Start Eos bridge.cmd**. The first time it opens `settings.cmd`
   in Notepad: fill in `SHOW_SERVER` and `DISPLAY_TOKEN`, save, start again.
   `settings.cmd` stays on that PC; it holds the token.
3. Leave the window open during the show; closing it stops the bridge.

**Test look.cmd** asks for a look, cue or scene and plays it; **List looks.cmd**
prints the lighting file. Edit `lighting.json` in that folder with Notepad;
the running bridge reloads it as on the laptop.

`settings.cmd` sets `EOS_HOST=127.0.0.1`, which wins over `eos.host` in the
lighting file, so the same `lighting.json` works on the laptop and the PC. If
the ping fails on `127.0.0.1` while Nomad is running, put the PC's own network
address there instead.

To update, build again and copy the new files over the old folder, keeping
`settings.cmd` (and `lighting.json` if it was edited on the PC). Windows may
show a SmartScreen or firewall prompt the first time `node.exe` runs; the
bridge only makes outgoing connections, so no inbound rule is needed.

## Trying looks in the room

```bash
pnpm eos-bridge --list                                  # fixtures, palette, looks, triggers
pnpm eos-bridge --test vier-felder                      # play one look
pnpm eos-bridge --test vier-felder --test nur-l4        # the second one fades from the first
pnpm eos-bridge --test licht-vier-felder                # a cue or scene name plays its look
pnpm eos-bridge --dry-run --test aus                    # print instead of sending
```

## During the show

```bash
export SHOW_SERVER=https://<show server>
export DISPLAY_TOKEN=<the display token>   # same secret the main display uses
pnpm eos-bridge
```

Leave the Terminal window visible. Every scene, cue, vote and look is logged
with the time. It says so when a cue has no look, when the server or the desk
cannot be reached, and stops with a clear message if the token is wrong. It
keeps retrying both: a dropped desk every 2 s, and the server even after an
error response such as a 502 while it restarts (1 s, 2 s, 4 s … up to every
30 s, back to 1 s once it is reachable again).

Each look's line ends with a small colour swatch per lamp, as the lamps should
look once the fade is done (`l1 ▇ l2 ▇ l3 -- l4 ··`: `--` is off, `··` not set
yet). It is a monitoring aid: amber and mint have no exact screen colour. The
swatches appear in a Terminal window only, not when the output goes to a file
(or with `NO_COLOR=1`).

The display token is a secret: don't put it in the lighting file or in git.

## Troubleshooting

- *cannot reach Eos …* — cable, address (`eos.host`), or Nomad not running.
- *Intensity works but only one lamp changes colour* — something is sending
  `/eos/param/<name>`, which hits the *selected* channels. The bridge addresses
  every value to its channel (`/eos/chan/<n>/param/<name>`).
- *A lamp cycles through colours on its own* — the lamp is not in the DMX mode
  or address the desk patched (19 channels for the KL Fresnel 8 FC). Fix it on
  the lamp's menu.
- *cue "…" · not in the lighting file* — the name in Studio and in
  `lighting.json` differ (they must match exactly), or that cue is for another
  bridge.
