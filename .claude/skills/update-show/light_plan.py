#!/usr/bin/env python3
"""Turn the light written in the script into the show's light plan.

Usage:
  python3 -I light_plan.py <parsed.json> <venue lighting.json> <mapping.json> <out-dir>

- parsed.json: output of check-script-updates/parse_script.py (lightCues, lightColours).
- venue lighting.json: the Eos bridge's current file. Its desk address (eos), lamps (fixtures
  `l1`-`l4`, the lamps L1-L4 of the script), colours (palette) and anything not generated from
  the script are kept.
- mapping.json: what only the show draft knows:
    {"scenes":  {"T2.2": "T2-2-regie",                     script scene ID -> phase ID (light at its start)
                 "K1.1.3": {"phase": "TEIL_1", "at": 125.4}},  or a phase and the seconds into it
     "winners": {"T2.5": {"q1": "L1", ...}}}              per vote scene: answer ID -> lamp of its field
  A script scene that runs inside a longer show scene (a question round whose monitors change at set
  times) gets the time its monitor cue starts at.

Writes to <out-dir>:
- lighting.json: the venue file plus the script's colours, one `licht-...` look per distinct
  `Licht:` cue (named after what it does, e.g. `licht-l1-l3-warm-l2-l4-off`), a scene trigger per
  show scene (its look, or its timed steps), and the vote results for "gewählte Gruppe ...
  hervorgehoben" scenes. The Studio draft needs no light cue names. What earlier runs generated
  (`licht-*` looks, cues and the scene triggers using them, `gewinner-*` looks and the vote results
  pointing at them) is rebuilt, so a cue removed from the script disappears from the file too.
- light-plan.md: what fires automatically, what the operator does on the desk, and every problem.

The convention is documented in docs/script-light-cues.md. Standard library only; the input is
untrusted and nothing is executed. Exit code 1 if there are problems.
"""
import json
import re
import sys
from pathlib import Path

CUE_PREFIX = "licht-"
WINNER_PREFIX = "gewinner-"
WINNER_OTHERS_LEVEL = 25    # when the script does not say
WINNER_FADE = 1.5
DEFAULT_FADE = 1.0          # seconds, when a cue does not say ("0s" snaps)
MAX_CUE_LENGTH = 120        # keeps look names readable in the bridge's log
EMITTERS = {"rot": "red", "red": "red", "gruen": "green", "green": "green", "blau": "blue", "blue": "blue",
            "amber": "amber", "mint": "mint"}
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
FADE_RE = re.compile(r"^(\d+(?:[.,]\d+)?)\s*(?:s|sek|sec)$", re.I)


def slug(text: str) -> str:
    """Script spelling -> file name: "Warm Weiß" -> "warm-weiss"."""
    text = text.strip().lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(a, b)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^a-z0-9#-]", "", text)
    return re.sub(r"-+", "-", text).strip("-")


def parse_number(token: str):
    token = token.strip().rstrip("%").replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def lamp_name(number):
    return "*" if number == "*" else f"l{number}"


def colours_from_table(rows, problems):
    """Rows of the colour table -> palette entries: {"cool": {"red": 0, "amber": 63, ...}}."""
    palette = {}
    for row in rows:
        where = f"colour \"{row['name']}\""
        colour, found = {"red": 0.0, "green": 0.0, "blue": 0.0, "amber": 0.0, "mint": 0.0}, False  # an empty cell is 0
        for header, cell in row.get("values", {}).items():
            emitter = EMITTERS.get(slug(header))
            if emitter is None:
                continue  # e.g. the monitor colour
            value = parse_number(cell) if cell.strip() else 0.0
            if value is None or not 0 <= value <= 100:
                problems.append(f"{where}: {header} \"{cell}\" is not a number 0–100")
                continue
            colour[emitter], found = value, True
        if found:
            palette[slug(row["name"])] = colour
        else:
            problems.append(f"{where}: no emitter values")
    return palette


def settings_of(text, palette, where, problems):
    """`Warm`, `off`, `50% Warm`, `an`, `2s` -> ({"color": ..., "level": ...}, fade or None)."""
    words = text.split()
    joined, i = [], 0  # colour names may have spaces ("Warm Weiß" is the palette's "warm-weiss")
    while i < len(words):
        for length in (3, 2):
            if i + length <= len(words) and slug(" ".join(words[i:i + length])) in palette:
                joined.append(" ".join(words[i:i + length]))
                i += length
                break
        else:
            joined.append(words[i])
            i += 1
    state, fade = {}, None
    for word in joined:
        key, number = slug(word), parse_number(word)
        if key in ("aus", "off"):
            state["level"] = 0
        elif key in ("an", "on", "voll", "full"):
            state["level"] = 100
        elif FADE_RE.match(word):
            fade = parse_number(FADE_RE.match(word).group(1))
        elif number is not None:
            if 0 <= number <= 100:
                state["level"] = number
            else:
                problems.append(f"{where}: level {word} is outside 0–100")
        elif HEX_RE.match(word):
            state["color"] = word.lower()
        elif key in palette:
            state["color"] = key
        else:
            problems.append(f"{where}: \"{word}\" is neither a colour ({', '.join(sorted(palette))}, #rrggbb), "
                            "a level (50%, an, off) nor a fade (2s)")
    if "color" in state and "level" not in state:
        state["level"] = 100  # "L1: Warm" switches the lamp on in that colour
    return state, fade


def look_of(cue, fixtures, palette, problems):
    """A `set` cue -> (name, look). The name says what it does, so the same cue gives the same name."""
    where = f"{cue['scene']}: \"{cue['text']}\""
    look, fade, name_parts = {"fixtures": {}}, None, []
    for part in cue["parts"]:
        lamps = [lamp_name(n) for n in part["lamps"]]
        unknown = [l for l in lamps if l != "*" and l not in fixtures]
        if unknown or not lamps:
            problems.append(f"{where}: no lamp {', '.join(u.upper() for u in unknown) or '?'} "
                            f"(lamps: {', '.join(sorted(l.upper() for l in fixtures))}, alle)")
            return None, None
        state, part_fade = settings_of(part["settings"], palette, where, problems)
        if not state:
            problems.append(f"{where}: nothing to set for {'+'.join(l.upper() for l in lamps)}")
            return None, None
        fade = part_fade if part_fade is not None else fade
        for lamp in lamps:
            look["fixtures"][lamp] = {**look["fixtures"].get(lamp, {}), **state}
        name_parts += ["alle" if lamps == ["*"] else "-".join(lamps), slug(part["settings"])]
    look["fade"] = DEFAULT_FADE if fade is None else fade
    name = CUE_PREFIX + slug("-".join(name_parts))
    if len(name) > MAX_CUE_LENGTH:
        problems.append(f"{where}: the cue name would be longer than {MAX_CUE_LENGTH} characters; split the cue")
        return None, None
    return name, look


def build(parsed, venue, mapping):
    problems = []
    fixtures = venue.get("fixtures", {})
    palette = {**venue.get("palette", {}), **colours_from_table(parsed.get("lightColours", []), problems)}

    # Drop what earlier runs generated, so cues removed from the script do not linger.
    looks = {k: v for k, v in venue.get("looks", {}).items() if not k.startswith((CUE_PREFIX, WINNER_PREFIX))}
    cues = {k: v for k, v in venue.get("cues", {}).items() if not k.startswith(CUE_PREFIX)}

    def generated(trigger):
        steps = [trigger] if isinstance(trigger, str) else [step.get("look", "") for step in trigger]
        return all(look.startswith(CUE_PREFIX) for look in steps)
    scene_triggers = {k: v for k, v in venue.get("scenes", {}).items() if not generated(v)}
    results = {phase: winners for phase, winners in venue.get("results", {}).items()
               if not winners or not all(look.startswith(WINNER_PREFIX) for look in winners.values())}
    steps, automatic, operator = {}, [], []  # steps: phase -> {seconds into it: look}
    scenes = mapping.get("scenes", {})

    for cue in parsed.get("lightCues", []):
        scene = cue["scene"]
        target = scenes.get(scene)
        phase, at = (target.get("phase"), float(target.get("at", 0))) if isinstance(target, dict) else (target, 0.0)
        if cue["kind"] == "prose":
            operator.append((scene, phase, cue["text"]))
            continue
        if phase is None:
            problems.append(f"{scene}: light cue but no phase for this scene in mapping.json")
            continue
        if cue["kind"] == "set":
            name, look = look_of(cue, fixtures, palette, problems)
            if look is None:
                continue
            looks[name] = look
            timed = steps.setdefault(phase, {})
            if at in timed and timed[at] != name:
                problems.append(f"{scene}: two light cues at the same moment of {phase} ({at:g} s: {timed[at]}, {name}); the last one wins")
            timed[at] = name
            automatic.append((scene, phase, f"{'scene start' if at == 0 else f'{at:g} s into the scene'} → {cue['text']}"))
        elif cue["kind"] == "winner":
            fields = mapping.get("winners", {}).get(scene)
            if not fields:
                problems.append(f"{scene}: vote winner light but no answer → lamp list for this scene in mapping.json")
                continue
            others = cue.get("others")
            others = WINNER_OTHERS_LEVEL if others is None else others
            per_answer = {}
            for answer, lamp in fields.items():
                lamp = slug(lamp)
                if lamp not in fixtures:
                    problems.append(f"{scene}: answer {answer} → unknown lamp \"{lamp}\"")
                    continue
                look_name = f"{WINNER_PREFIX}{lamp}-{others:g}"
                looks[look_name] = {"fade": WINNER_FADE, "fixtures": {"*": {"level": others}, lamp: {"level": 100}}}
                per_answer[answer] = look_name
            if per_answer:
                results[phase] = per_answer
                automatic.append((scene, phase, f"vote decided → winning field full, others {others:g}%"))

    for phase, timed in steps.items():
        if phase in scene_triggers:
            problems.append(f"{phase}: replaces the hand-made scene trigger {json.dumps(scene_triggers[phase], ensure_ascii=False)}")
        ordered = sorted(timed.items())
        scene_triggers[phase] = ordered[0][1] if len(ordered) == 1 and ordered[0][0] == 0 else \
            [{"at": at, "look": look} for at, look in ordered]
    lighting = {**venue, "palette": palette, "looks": looks, "cues": cues, "scenes": scene_triggers, "results": results}
    return lighting, automatic, operator, problems


def report(automatic, operator, problems):
    lines = ["# Light plan from the script", ""]
    lines += ["## Fires automatically", ""] + ([f"- {s} ({p}): {what}" for s, p, what in automatic] or ["- (none)"])
    lines += ["", "## Operator on the desk (written as text, not as a cue)", ""]
    lines += [f"- {s}{f' ({p})' if p else ''}: {text}" for s, p, text in operator] or ["- (none)"]
    lines += ["", "## Problems", ""] + ([f"- {line}" for line in problems] or ["- (none)"])
    return "\n".join(lines) + "\n"


def main():
    parsed_path, venue_path, mapping_path, out_dir = sys.argv[1:5]
    parsed = json.loads(Path(parsed_path).read_text(encoding="utf-8"))
    venue = json.loads(Path(venue_path).read_text(encoding="utf-8"))
    mapping = json.loads(Path(mapping_path).read_text(encoding="utf-8"))
    lighting, automatic, operator, problems = build(parsed, venue, mapping)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "lighting.json").write_text(json.dumps(lighting, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "light-plan.md").write_text(report(automatic, operator, problems), encoding="utf-8")
    print(f"{len(automatic)} automatic, {len(operator)} for the operator, {len(problems)} problems -> {out}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
