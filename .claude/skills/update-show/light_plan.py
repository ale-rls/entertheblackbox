#!/usr/bin/env python3
"""Turn the light cues and looks written in the script into the show's light plan.

Usage:
  python3 -I light_plan.py <parsed.json> <venue lighting.json> <mapping.json> <out-dir>

- parsed.json: output of check-script-updates/parse_script.py (lightCues, lightLooks, lightColours).
- venue lighting.json: the Eos bridge's current file. Its desk address (eos), lamps (fixtures),
  colours (palette) and anything not written in the script are kept.
- mapping.json: what only the show draft knows:
    {"scenes":  {"T2.2": "T2-2-regie", ...},              script scene ID -> phase ID
     "winners": {"T2.5": {"q1": "feld-rot", ...}}}         per vote scene: answer ID -> lamp it lights

Writes to <out-dir>:
- lighting.json: the venue file plus the script's colours and looks, a `licht-<look>` cue per look
  used at a scene start, and the vote results for `LICHT Gewinner` scenes. What earlier runs
  generated (`licht-*` cues, `gewinner-*` looks and the vote results pointing at them) is rebuilt,
  so a cue removed from the script disappears from the file too. A look the script defines replaces
  a hand-made look of the same name.
- phase-cues.json: phase ID -> the `licht-*` cue names its External show cues must contain.
- light-plan.md: what fires automatically, what the operator does on the desk, and every problem.

The convention is documented in docs/script-light-cues.md. Standard
library only; the input is untrusted and nothing is executed. Exit code 1 if there are problems.
"""
import json
import re
import sys
from pathlib import Path

CUE_PREFIX = "licht-"
WINNER_PREFIX = "gewinner-"
WINNER_OTHERS_LEVEL = 10
WINNER_FADE = 1.5
EMITTERS = {"rot": "red", "red": "red", "gruen": "green", "green": "green", "blau": "blue", "blue": "blue",
            "amber": "amber", "mint": "mint"}
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def slug(text: str) -> str:
    """Script spelling -> file name: "Feld grün" -> "feld-gruen"."""
    text = text.strip().lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(a, b)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"[^a-z0-9#-]", "", text)
    return re.sub(r"-+", "-", text).strip("-")


def entries(cell: str):
    """`a: x · b: y; c: z` (or one per line) -> ["a: x", "b: y", "c: z"]."""
    return [part.strip() for part in re.split(r"[·;\n]", cell) if part.strip()]


def parse_number(token: str):
    token = token.rstrip("%").replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def parse_colour(cell: str, problems, where):
    """`#rrggbb`, or emitters: `rot 100 · grün 55 · amber 100`."""
    cell = cell.strip()
    if HEX_RE.match(cell):
        return cell.lower()
    colour = {}
    for part in entries(cell):
        words = part.replace(":", " ").split()
        if len(words) != 2 or slug(words[0]) not in EMITTERS or parse_number(words[1]) is None:
            problems.append(f"{where}: cannot read \"{part}\" (write e.g. \"rot 100\" or #rrggbb)")
            continue
        value = parse_number(words[1])
        if not 0 <= value <= 100:
            problems.append(f"{where}: {words[0]} {words[1]} is outside 0–100")
            continue
        colour[EMITTERS[slug(words[0])]] = value
    return colour or None


def parse_look(row, fixtures, palette, problems):
    """A row of the "Lichtstimmung" table -> (name, look) in the bridge's format."""
    name = slug(row[0])
    where = f"Lichtstimmung \"{row[0]}\""
    if len(row) < 2:
        problems.append(f"{where}: no lamps given")
        return name, None
    look = {"fixtures": {}}
    if len(row) > 2 and row[2].strip():
        fade = parse_number(row[2].strip().rstrip("s").strip())
        if fade is None or not 0 <= fade <= 600:
            problems.append(f"{where}: fade \"{row[2]}\" is not a number of seconds")
        else:
            look["fade"] = fade
    for part in entries(row[1]):
        if ":" not in part:
            problems.append(f"{where}: \"{part}\" needs \"lamp: setting\", e.g. \"Feld rot: rot 100\" or \"alle: 0\"")
            continue
        lamp_text, settings = part.split(":", 1)
        lamp = "*" if slug(lamp_text) == "alle" else slug(lamp_text)
        if lamp != "*" and lamp not in fixtures:
            problems.append(f"{where}: no lamp \"{lamp_text.strip()}\" (lamps: alle, {', '.join(sorted(fixtures))})")
            continue
        state = {}
        for word in settings.split():
            key = slug(word)
            number = parse_number(word)
            if key == "aus":
                state["level"] = 0
            elif key in ("an", "voll"):
                state["level"] = 100
            elif number is not None:
                if not 0 <= number <= 100:
                    problems.append(f"{where}: level {word} is outside 0–100")
                else:
                    state["level"] = number
            elif HEX_RE.match(word):
                state["color"] = word.lower()
            elif key in palette:
                state["color"] = key
            else:
                problems.append(f"{where}: \"{word}\" is neither a colour ({', '.join(sorted(palette))}, #rrggbb) nor a level")
        if state:
            look["fixtures"][lamp] = {**look["fixtures"].get(lamp, {}), **state}
    if not look["fixtures"]:
        problems.append(f"{where}: no usable lamp settings")
        return name, None
    return name, look


def build(parsed, venue, mapping):
    problems, notes = [], []
    fixtures = venue.get("fixtures", {})
    palette = dict(venue.get("palette", {}))

    for row in parsed.get("lightColours", []):
        if len(row) < 2:
            problems.append(f"Lichtfarbe \"{row[0]}\": no mix given")
            continue
        colour = parse_colour(row[1], problems, f"Lichtfarbe \"{row[0]}\"")
        if colour is not None:
            palette[slug(row[0])] = colour

    script_looks = {}
    for row in parsed.get("lightLooks", []):
        name, look = parse_look(row, fixtures, palette, problems)
        if look is not None:
            if name in script_looks:
                problems.append(f"Lichtstimmung \"{row[0]}\" is defined twice")
            script_looks[name] = look

    # Drop what earlier runs generated, so cues removed from the script do not linger.
    kept_looks = {k: v for k, v in venue.get("looks", {}).items() if not k.startswith(WINNER_PREFIX)}
    looks = {**kept_looks, **script_looks}
    cues = {k: v for k, v in venue.get("cues", {}).items() if not k.startswith(CUE_PREFIX)}
    results = {phase: winners for phase, winners in venue.get("results", {}).items()
               if not winners or not all(look.startswith(WINNER_PREFIX) for look in winners.values())}
    phase_cues, automatic, operator = {}, [], []
    scenes = mapping.get("scenes", {})

    for cue in parsed.get("lightCues", []):
        scene = cue["scene"]
        phase = scenes.get(scene)
        if cue["kind"] in ("operator", "prose"):
            operator.append((scene, phase, cue["text"], cue["kind"]))
            continue
        if phase is None:
            problems.append(f"{scene}: light cue but no phase for this scene in mapping.json")
            continue
        if cue["kind"] == "look":
            look = slug(cue["look"])
            if look not in looks:
                problems.append(f"{scene}: LICHT: {cue['look']} — no Lichtstimmung of that name")
                continue
            name = CUE_PREFIX + look
            cues[name] = look
            listed = phase_cues.setdefault(phase, [])
            if name not in listed:
                listed.append(name)
            if len(listed) > 1:
                problems.append(f"{scene}: several light looks at the same scene start ({', '.join(listed)}); the last one wins")
            automatic.append((scene, phase, f"scene start → {look}"))
        elif cue["kind"] == "winner":
            fields = mapping.get("winners", {}).get(scene)
            if not fields:
                problems.append(f"{scene}: LICHT Gewinner but no answer → lamp list for this scene in mapping.json")
                continue
            per_answer = {}
            for answer, lamp in fields.items():
                lamp = slug(lamp)
                if lamp not in fixtures:
                    problems.append(f"{scene}: answer {answer} → unknown lamp \"{lamp}\"")
                    continue
                look_name = WINNER_PREFIX + lamp
                looks[look_name] = {"fade": WINNER_FADE, "fixtures": {"*": {"level": WINNER_OTHERS_LEVEL}, lamp: {"level": 100}}}
                per_answer[answer] = look_name
            if per_answer:
                results[phase] = per_answer
                automatic.append((scene, phase, "vote decided → winning field full, others " f"{WINNER_OTHERS_LEVEL}%"))

    lighting = {**venue, "palette": palette, "looks": looks, "cues": cues, "results": results}
    return lighting, phase_cues, automatic, operator, problems


def report(automatic, operator, problems, phase_cues):
    lines = ["# Light plan from the script", ""]
    lines += ["## Fires automatically", ""] + ([f"- {s} ({p}): {what}" for s, p, what in automatic] or ["- (none)"])
    lines += ["", "## Scene cue names for the draft (External show cues)", ""]
    lines += [f"- {phase}: {', '.join(names)}" for phase, names in phase_cues.items()] or ["- (none)"]
    lines += ["", "## Operator on the desk", ""]
    lines += [f"- {s}{f' ({p})' if p else ''}: {text}{' — written as prose, not in the convention' if kind == 'prose' else ''}"
              for s, p, text, kind in operator] or ["- (none)"]
    lines += ["", "## Problems", ""] + ([f"- {line}" for line in problems] or ["- (none)"])
    return "\n".join(lines) + "\n"


def main():
    parsed_path, venue_path, mapping_path, out_dir = sys.argv[1:5]
    parsed = json.loads(Path(parsed_path).read_text(encoding="utf-8"))
    venue = json.loads(Path(venue_path).read_text(encoding="utf-8"))
    mapping = json.loads(Path(mapping_path).read_text(encoding="utf-8"))
    lighting, phase_cues, automatic, operator, problems = build(parsed, venue, mapping)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "lighting.json").write_text(json.dumps(lighting, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "phase-cues.json").write_text(json.dumps(phase_cues, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "light-plan.md").write_text(report(automatic, operator, problems, phase_cues), encoding="utf-8")
    print(f"{len(automatic)} automatic, {len(operator)} for the operator, {len(problems)} problems -> {out}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
