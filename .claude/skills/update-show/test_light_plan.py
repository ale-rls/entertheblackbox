#!/usr/bin/env python3
"""Light cues from a script export to the Eos bridge's lighting.json.

Run: python3 -I .claude/skills/update-show/test_light_plan.py   (from the repo root)

Uses synthetic exports in the Google Docs HTML shape and a synthetic .docx (generic text, no show
content), runs parse_script.py and light_plan.py on them, and checks the result with the bridge's
own validation (`pnpm eos-bridge --list`).
"""
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PARSER = REPO / ".claude/skills/check-script-updates/parse_script.py"
PLAN = HERE / "light_plan.py"

Y = 'style="background-color:#ffff00"'  # yellow highlight: Licht / Bühne
M = 'style="background-color:#ff00ff"'  # magenta: Code


def cell(*paras):
    return "<td>" + "".join(f"<p>{p}</p>" for p in paras) + "</td>"


def y(text):
    return f"<span {Y}>{text}</span>"


EXPORT = f"""<html><body>
<p><span>Legende</span></p>
<table>
<tr>{cell('Name used in script')}{cell('Red')}{cell('Amber')}{cell('Mint')}{cell('Green')}{cell('Blue')}{cell('Monitor color (M1-4)')}</tr>
<tr>{cell('Kalt')}{cell('0')}{cell('63')}{cell('100')}{cell('13')}{cell('100')}{cell('#faf3dd')}</tr>
<tr>{cell('Glut ')}{cell('100')}{cell('100')}{cell('72')}{cell('0')}{cell('')}{cell('#ffa69e')}</tr>
</table>
<table>
<tr>{cell('T1.1.v1 Eins', 'Text eins.', y('Licht: L1+L3: Kalt L2+L4: off'))}{cell('')}</tr>
<tr>{cell('T1.2.v1 Zwei', f'<span {M}>[Code] Abstimmung.</span>', y('Die gewählte Gruppe wird durch Licht hervorgehoben. (andere drei Farben auf 30% Helligkeit)'))}{cell('')}</tr>
<tr>{cell('T1.3.v2 Drei', y('[LICHT: Saal hell; Bühne dunkel.]'), 'Licht hebt die Gruppe hervor.', y('Das ist Pflicht, ganz schlicht.'))}{cell('')}</tr>
<tr>{cell('T1.4.v1 Vier', y('Licht: 50% Glut auf L1-L4'))}{cell('')}</tr>
<tr>{cell('T1.5.v1 Fünf', y('Licht: L1: Gibtsnicht'))}{cell('')}</tr>
<tr>{cell('T1.6.v1 Sechs', y('Licht: L5: Kalt'))}{cell('')}</tr>
<tr>{cell('T1.7.v1 Sieben', y('Glut on lights 1-4'))}{cell('')}</tr>
<tr>{cell('T1.8.v1 Acht', y('Licht: alle: aus 3s'))}{cell('')}</tr>
</table>
</body></html>"""

VENUE = {
    "eos": {"host": "10.0.0.1"},
    "fixtures": {"l1": {"channel": 11}, "l2": {"channel": 13}, "l3": {"channel": 12}, "l4": {"channel": 10}},
    "palette": {"rot": {"red": 100}},
    "looks": {"aus": {"fade": 3, "fixtures": {"*": {"level": 0}}}, "eigen": {"fixtures": {"*": {"level": 50}}},
              "licht-alt": {"fixtures": {"*": {"level": 20}}}, "gewinner-l1-10": {"fixtures": {"l1": {"level": 100}}}},
    "cues": {"licht-alt": "licht-alt", "musik-start": "aus"},
    "results": {"T0-alt": {"q1": "gewinner-l1-10"}},
    "showEnd": "aus",
}
SCENES = {f"T1.{n}": f"T1-{n}" for n in range(1, 9)}
MAPPING = {"scenes": SCENES, "winners": {"T1.2": {"q1": "L1", "q2": "L2", "q3": "l3", "q4": "L4"}}}


def run_parser(source: Path):
    out = source.with_suffix(".json")
    subprocess.run([sys.executable, "-I", str(PARSER), str(source), str(out)], check=True, capture_output=True)
    return json.loads(out.read_text(encoding="utf-8"))


def parse(export):
    folder = Path(tempfile.mkdtemp())
    (folder / "export.html").write_text(export, encoding="utf-8")
    return run_parser(folder / "export.html")


def plan(parsed, venue, mapping):
    folder = Path(tempfile.mkdtemp())
    for name, data in (("parsed.json", parsed), ("venue.json", venue), ("mapping.json", mapping)):
        (folder / name).write_text(json.dumps(data), encoding="utf-8")
    run = subprocess.run([sys.executable, "-I", str(PLAN), *(str(folder / n) for n in ("parsed.json", "venue.json", "mapping.json")),
                          str(folder / "out")], capture_output=True, text=True)
    return json.loads((folder / "out/lighting.json").read_text(encoding="utf-8")), run, folder / "out"


class LightPlan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parsed = parse(EXPORT)
        cls.lighting, cls.plan_run, out = plan(cls.parsed, VENUE, MAPPING)
        cls.report = (out / "light-plan.md").read_text(encoding="utf-8")
        cls.out = out

    def test_parser_finds_cues_by_kind(self):
        kinds = [(c["scene"], c["kind"]) for c in self.parsed["lightCues"]]
        self.assertEqual(kinds, [("T1.1", "set"), ("T1.2", "winner"), ("T1.3", "prose"), ("T1.4", "set"),
                                 ("T1.5", "set"), ("T1.6", "set"), ("T1.7", "set"), ("T1.8", "set")])
        self.assertEqual(self.parsed["lightCues"][0]["parts"], [{"lamps": [1, 3], "settings": "Kalt"}, {"lamps": [2, 4], "settings": "off"}])
        self.assertEqual(self.parsed["lightCues"][1]["others"], 30)
        self.assertEqual(self.parsed["lightCues"][3]["parts"], [{"lamps": [1, 2, 3, 4], "settings": "50% Glut"}])
        self.assertEqual(self.parsed["lightCues"][6]["parts"], [{"lamps": [1, 2, 3, 4], "settings": "Glut"}])
        self.assertEqual(self.parsed["lightCues"][7]["parts"], [{"lamps": ["*"], "settings": "aus 3s"}])

    def test_stage_directions_are_not_cues(self):
        texts = [c["text"] for c in self.parsed["lightCues"]]
        self.assertFalse(any("hebt" in text or "Pflicht" in text for text in texts))

    def test_parser_reads_the_colour_table(self):
        self.assertEqual([row["name"] for row in self.parsed["lightColours"]], ["Kalt", "Glut"])

    def test_colours(self):
        palette = self.lighting["palette"]
        self.assertEqual(palette["kalt"], {"red": 0.0, "green": 13.0, "blue": 100.0, "amber": 63.0, "mint": 100.0})
        self.assertEqual(palette["glut"], {"red": 100.0, "amber": 100.0, "mint": 72.0, "green": 0.0, "blue": 0.0})  # empty cell = 0
        self.assertEqual(palette["rot"], {"red": 100})  # the venue's colours stay

    def test_each_cue_becomes_a_look_and_a_scene_trigger(self):
        looks = self.lighting["looks"]
        self.assertEqual(looks["licht-l1-l3-kalt-l2-l4-off"], {"fixtures": {"l1": {"color": "kalt", "level": 100}, "l3": {"color": "kalt", "level": 100},
                                                                            "l2": {"level": 0}, "l4": {"level": 0}}, "fade": 1.0})
        self.assertEqual(looks["licht-l1-l2-l3-l4-50-glut"]["fixtures"]["l2"], {"level": 50.0, "color": "glut"})
        self.assertEqual(looks["licht-alle-aus-3s"], {"fixtures": {"*": {"level": 0}}, "fade": 3.0})
        self.assertEqual(self.lighting["scenes"], {"T1-1": "licht-l1-l3-kalt-l2-l4-off", "T1-4": "licht-l1-l2-l3-l4-50-glut",
                                                   "T1-7": "licht-l1-l2-l3-l4-glut", "T1-8": "licht-alle-aus-3s"})
        self.assertEqual(self.lighting["cues"], {"musik-start": "aus"})  # no cue names needed in the draft

    def test_vote_winner_lights_its_field(self):
        self.assertEqual(self.lighting["results"]["T1-2"], {"q1": "gewinner-l1-30", "q2": "gewinner-l2-30", "q3": "gewinner-l3-30", "q4": "gewinner-l4-30"})
        self.assertEqual(self.lighting["looks"]["gewinner-l2-30"], {"fade": 1.5, "fixtures": {"*": {"level": 30}, "l2": {"level": 100}}})

    def test_earlier_generated_entries_are_rebuilt_and_the_rest_kept(self):
        for key in ("eos", "fixtures", "showEnd"):
            self.assertEqual(self.lighting[key], VENUE[key])
        self.assertEqual(self.lighting["looks"]["eigen"], VENUE["looks"]["eigen"])
        self.assertNotIn("licht-alt", self.lighting["looks"])
        self.assertNotIn("licht-alt", self.lighting["cues"])
        self.assertNotIn("gewinner-l1-10", self.lighting["looks"])
        self.assertNotIn("T0-alt", self.lighting["results"])
        self.assertEqual(self.lighting["cues"]["musik-start"], "aus")

    def test_report_lists_operator_notes_and_problems(self):
        self.assertEqual(self.plan_run.returncode, 1)
        self.assertIn("Saal hell", self.report)
        self.assertIn("\"Gibtsnicht\" is neither a colour", self.report)
        self.assertIn("no lamp L5 (lamps: L1, L2, L3, L4, alle)", self.report)

    def test_the_bridge_accepts_the_file(self):
        result = subprocess.run(["pnpm", "--silent", "eos-bridge", "--config", str(self.out / "lighting.json"), "--list"],
                                cwd=REPO, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("vote T1-2 → q1 → gewinner-l1-30", result.stdout)
        self.assertIn("scene T1-1 → licht-l1-l3-kalt-l2-l4-off", result.stdout)


class ScriptLayout(unittest.TestCase):
    """Where cues sit in the real script's two-column table."""

    def cues(self, rows):
        parsed = parse("<html><body><p>Legende</p><table>" + "".join(rows) + "</table></body></html>")
        return [(c["scene"], c["kind"]) for c in parsed["lightCues"]]

    def test_two_cues_split_by_a_line_break(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins', y('Licht: L1: an<br>Licht: L2: off'))}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.1", "set"), ("T1.1", "set")])

    def test_cue_in_the_other_column_of_the_scene_row(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins')}{cell('')}</tr>", f"<tr>{cell(y('Licht: L1: an'))}{cell('T1.2.v1 Zwei')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.2", "set")])

    def test_cue_in_a_cell_without_heading_belongs_to_the_last_scene(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins')}{cell('')}</tr>", f"<tr>{cell(y('Licht: L1: an'))}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.1", "set")])

    def test_cue_without_heading_prefers_its_own_column(self):
        rows = [f"<tr>{cell('K1.1.v1 Links')}{cell('')}</tr>", f"<tr>{cell('')}{cell('T1.1.v1 Rechts')}</tr>",
                f"<tr>{cell(y('Licht: L1: an'))}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("K1.1", "set")])

    def test_heading_after_a_line_break(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins', 'Ende der Szene.<br>T1.2.v3 Zwei<br>' + y('Licht: L1: an'))}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.2", "set")])

    def test_long_heading_that_holds_the_first_sentence(self):
        long = "K1.7.v4 (war K1.6.v3) Kopfhörer: " + "Ein langer erster Satz der Szene. " * 6
        rows = [f"<tr>{cell('K1.6.v4 Sechs', long, y('Licht: L1: an'))}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("K1.7", "set")])

    def test_prose_shows_the_whole_line(self):
        parsed = parse(f"<html><body><p>L</p><table><tr>{cell('T1.1.v1 Eins', '[Code/Video/' + y('Licht:') + ' Person markieren.]')}</tr></table></body></html>")
        self.assertEqual(parsed["lightCues"][0]["text"], "[Code/Video/Licht: Person markieren.]")


def grid(*cells):
    """A 2×2 table inside a script cell: cells in reading order (top left, top right, bottom left, bottom right)."""
    a, b, c, d = cells
    return f"<table><tr>{cell(a)}{cell(b)}</tr><tr>{cell(c)}{cell(d)}</tr></table>"


GRID_EXPORT = f"""<html><body>
<p><span>Legende</span></p>
<table>
<tr>{cell('Name used in script')}{cell('Red')}{cell('Amber')}{cell('Mint')}{cell('Green')}{cell('Blue')}</tr>
<tr>{cell('Kalt')}{cell('0')}{cell('63')}{cell('100')}{cell('13')}{cell('100')}</tr>
<tr>{cell('Glut')}{cell('100')}{cell('100')}{cell('72')}{cell('0')}{cell('')}</tr>
</table>
<p>Lampen wie Monitore:</p>
<table><tr>{cell(y('M3/L3'))}{cell(y('M2/L2'))}</tr><tr>{cell(y('M4/L4'))}{cell(y('M1/L1'))}</tr></table>
<table>
<tr><td><p>K1.1.v1 Links</p>{grid('12', '13', '10', '11')}<p>K1.2.v1 Links zwei</p>{grid('M3: Nie', 'M2: Frage?', 'M4: Frage?', 'M1: Immer')}<p>{y('Licht: L1+L3 Glut, L2+L4 off')}</p></td>
<td><p>T1.1.v1 Rechts</p></td></tr>
<tr><td><p>K2.1.v1 Links</p></td>
<td><p>T2.1.v1 Wahl</p><p>Auf Monitoren</p>{grid('M3: Eins ' + y('(Glut)'), 'M2: Zwei ' + y('(Kalt)'), 'M4: Drei ' + y('(Kalt)'), 'M1: Vier ' + y('(Glut)'))}
<p>T2.2.v1 Weiter</p>{grid('M3 Ja', 'M2 Ja', 'M4 Nein', 'M1 Nein')}
<p>{y('Die gewählte Gruppe wird durch Licht hervorgehoben.')}</p>
<p>T2.3.v1 Arbeit</p>{grid('M3/L3 Kalt: Chor', 'M2/L2 Glut: Bühne', 'M2: Haupt', 'M1/L1 Kalt: Pause')}
<p>{y('L1-4 Glut 100%')}</p><p>{y('Nach 10 Sekunden Flackern auf L1-L4')}</p><p>{y('[LICHT: L1+L2 markieren die vordere Zone; L3+L4 die hintere.]')}</p></td></tr>
</table>
</body></html>"""


class FieldGrids(unittest.TestCase):
    """The script's 2×2 field grids: monitor text and colour per field (Mn is lit by Ln)."""

    @classmethod
    def setUpClass(cls):
        cls.parsed = parse(GRID_EXPORT)
        cls.grids = cls.parsed["fieldGrids"]

    def test_layout_comes_from_the_legend_grid(self):
        self.assertEqual(self.parsed["fieldLayout"], [["M3", "M2"], ["M4", "M1"]])

    def test_a_grid_of_numbers_is_an_instruction(self):
        self.assertEqual(self.parsed["instructionGrids"], [{"scene": "K1.1", "paragraph": 1 + self.first_script_paragraph(),
                                                            "cells": {"M3": "12", "M2": "13", "M4": "10", "M1": "11"}}])

    def first_script_paragraph(self):
        return next(p["index"] for p in self.parsed["paragraphs"] if p["text"].startswith("K1.1.v1"))

    def test_monitor_text_per_field_without_labels(self):
        self.assertEqual([(g["scene"], {f: v["text"] for f, v in g["fields"].items()}) for g in self.grids[:3]], [
            ("K1.2", {"M1": "Immer", "M2": "Frage?", "M3": "Nie", "M4": "Frage?"}),
            ("T2.1", {"M1": "Vier", "M2": "Zwei", "M3": "Eins", "M4": "Drei"}),
            ("T2.2", {"M1": "Nein", "M2": "Ja", "M3": "Ja", "M4": "Nein"})])

    def test_colours_and_lamps(self):
        regie = self.grids[1]
        self.assertEqual(regie["colours"], "own")
        self.assertEqual({f: (v["lamp"], v["colour"]) for f, v in regie["fields"].items()},
                         {"M1": ("L1", "Glut"), "M2": ("L2", "Kalt"), "M3": ("L3", "Glut"), "M4": ("L4", "Kalt")})

    def test_a_grid_without_colours_keeps_the_last_ones(self):
        weiter = self.grids[2]
        self.assertEqual((weiter["colours"], weiter["coloursFrom"]), ("carried", self.grids[1]["paragraph"]))
        self.assertEqual(weiter["fields"]["M3"]["colour"], "Glut")
        self.assertIsNone(self.grids[0]["fields"]["M1"]["colour"])  # before any coloured grid

    def test_colour_in_the_label_and_a_label_in_the_wrong_place(self):
        arbeit = self.grids[3]
        self.assertEqual(arbeit["fields"]["M3"], {"lamp": "L3", "text": "Chor", "colour": "Kalt"})
        self.assertIn("labelled M2, but the legend puts M4 in this position", " ".join(self.parsed["problems"]))
        self.assertIn("gives no colour for M4", " ".join(self.parsed["problems"]))

    def test_a_coloured_grid_is_a_light_cue_and_tells_the_winner_its_colours(self):
        cues = [(c["scene"], c["kind"], c.get("parts")) for c in self.parsed["lightCues"] if c.get("source") == "grid"]
        self.assertEqual(cues[0], ("T2.1", "set", [{"lamps": [1], "settings": "Glut"}, {"lamps": [2], "settings": "Kalt"},
                                                   {"lamps": [3], "settings": "Glut"}, {"lamps": [4], "settings": "Kalt"}]))
        winner = next(c for c in self.parsed["lightCues"] if c["kind"] == "winner")
        self.assertEqual((winner["scene"], winner["fieldColours"]), ("T2.2", {"L1": "Glut", "L2": "Kalt", "L3": "Glut", "L4": "Kalt"}))

    def test_a_grid_does_not_move_the_script_column(self):
        cue = next(c for c in self.parsed["lightCues"] if c["text"].startswith("Licht: L1+L3"))
        self.assertEqual(cue["scene"], "K1.2")  # the left column, below two grids
        para = self.parsed["paragraphs"][cue["paragraph"]]
        self.assertEqual((para["row"], para["col"]), (0, 0))

    def test_cue_wording_without_colon_or_without_licht(self):
        by_text = {c["text"]: c for c in self.parsed["lightCues"]}
        self.assertEqual(by_text["Licht: L1+L3 Glut, L2+L4 off"]["parts"], [{"lamps": [1, 3], "settings": "Glut"}, {"lamps": [2, 4], "settings": "off"}])
        self.assertEqual(by_text["L1-4 Glut 100%"]["parts"], [{"lamps": [1, 2, 3, 4], "settings": "Glut 100%"}])
        self.assertEqual(by_text["Nach 10 Sekunden Flackern auf L1-L4"]["kind"], "prose")  # never dropped
        self.assertEqual(by_text["[LICHT: L1+L2 markieren die vordere Zone; L3+L4 die hintere.]"]["kind"], "prose")

    def test_text_after_a_comma_without_lamps_is_for_the_operator(self):
        parsed = parse(f"<html><body><p>L</p><table><tr>{cell('T1.1.v1 Eins', y('Licht: L1-4 off, Saal hell'))}</tr></table></body></html>")
        self.assertEqual([(c["kind"], c["text"]) for c in parsed["lightCues"]],
                         [("set", "Licht: L1-4 off, Saal hell"), ("prose", "Saal hell")])

    def test_heading_with_a_trailing_dot(self):
        parsed = parse(f"<html><body><p>L</p><table><tr>{cell('T1.1.1. Frage', y('Licht: L1: an'))}</tr></table></body></html>")
        self.assertEqual(parsed["lightCues"][0]["scene"], "T1.1.1")


class Docx(unittest.TestCase):
    """A .docx is read directly: Word highlights become the same colours as in the HTML export."""

    def test_highlighted_cue_in_a_table(self):
        w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

        def para(text, highlight=None):
            rpr = f'<w:rPr><w:highlight w:val="{highlight}"/></w:rPr>' if highlight else ""
            return f'<w:p><w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'

        body = (para("Legende") + "<w:tbl><w:tr><w:tc>" + para("T1.1.v1 Eins") + para("Licht: L1+L2: an", "yellow")
                + para("Licht: L3: off") + "</w:tc></w:tr></w:tbl>")
        folder = Path(tempfile.mkdtemp())
        with zipfile.ZipFile(folder / "script.docx", "w") as z:
            z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document {w}><w:body>{body}</w:body></w:document>')
        parsed = run_parser(folder / "script.docx")
        self.assertEqual([(c["scene"], c["kind"], c.get("parts")) for c in parsed["lightCues"]],
                         [("T1.1", "set", [{"lamps": [1, 2], "settings": "an"}])])  # the un-highlighted line is not a cue


class Reruns(unittest.TestCase):
    def test_a_winner_removed_from_the_script_is_gone_after_the_next_run(self):
        first, _, _ = plan({"lightCues": [{"scene": "T1.2", "kind": "winner", "text": "…", "others": None}]}, VENUE, MAPPING)
        self.assertEqual(first["results"]["T1-2"]["q1"], "gewinner-l1-25")  # 25 % when the script gives no level
        hand_made = {**first, "results": {**first["results"], "andere-wahl": {"q1": "eigen"}}}
        second, _, _ = plan({"lightCues": []}, hand_made, MAPPING)
        self.assertFalse(any(name.startswith("gewinner-") for name in second["looks"]))
        self.assertEqual(second["results"], {"andere-wahl": {"q1": "eigen"}})  # hand-made vote entries stay

    def test_a_cue_removed_from_the_script_is_gone_after_the_next_run(self):
        cue = {"scene": "T1.1", "kind": "set", "text": "Licht: L1: an", "parts": [{"lamps": [1], "settings": "an"}]}
        venue = {**VENUE, "scenes": {"eigene-szene": "eigen"}}
        first, _, _ = plan({"lightCues": [cue]}, venue, MAPPING)
        self.assertEqual(first["scenes"]["T1-1"], "licht-l1-an")
        second, _, _ = plan({"lightCues": []}, first, MAPPING)
        self.assertEqual(second["scenes"], {"eigene-szene": "eigen"})  # hand-made scene triggers stay
        self.assertNotIn("licht-l1-an", second["looks"])
        self.assertIn("musik-start", second["cues"])


def set_cue(scene, text, lamps, settings):
    return {"scene": scene, "kind": "set", "text": text, "parts": [{"lamps": lamps, "settings": settings}]}


class TimedSteps(unittest.TestCase):
    """Script scenes inside one longer show scene: light at the time each one's monitor cue starts."""

    def setUp(self):
        self.cues = [set_cue("K1.1", "Licht: L1-L4: an", [1, 2, 3, 4], "an"),
                     set_cue("K1.2", "Licht: L1: off", [1], "off"),
                     set_cue("K1.3", "Licht: L1-L4: an", [1, 2, 3, 4], "an")]
        self.mapping = {"scenes": {"K1.1": "runde", "K1.2": {"phase": "runde", "at": 125.4}, "K1.3": {"phase": "runde", "at": 140}}}

    def test_steps_in_time_order(self):
        lighting, run, out = plan({"lightCues": list(reversed(self.cues))}, VENUE, self.mapping)
        self.assertEqual(run.returncode, 0, run.stdout)
        self.assertEqual(lighting["scenes"]["runde"], [{"at": 0.0, "look": "licht-l1-l2-l3-l4-an"},
                                                       {"at": 125.4, "look": "licht-l1-off"},
                                                       {"at": 140.0, "look": "licht-l1-l2-l3-l4-an"}])
        self.assertIn("125.4 s into the scene", (out / "light-plan.md").read_text(encoding="utf-8"))
        result = subprocess.run(["pnpm", "--silent", "eos-bridge", "--config", str(out / "lighting.json"), "--list"],
                                cwd=REPO, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("scene runde at 125.4 s → licht-l1-off", result.stdout)

    def test_two_cues_at_the_same_moment_are_a_problem(self):
        mapping = {"scenes": {"K1.1": "runde", "K1.2": "runde", "K1.3": {"phase": "runde", "at": 140}}}
        _, run, out = plan({"lightCues": self.cues}, VENUE, mapping)
        self.assertEqual(run.returncode, 1)
        self.assertIn("two light cues at the same moment of runde", (out / "light-plan.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
