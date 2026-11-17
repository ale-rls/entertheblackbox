#!/usr/bin/env python3
"""Light cues from a script export to the Eos bridge's lighting.json.

Run: python3 -I .claude/skills/update-show/test_light_plan.py   (from the repo root)

Uses a synthetic export in the Google Docs HTML shape (generic text, no show content), runs
parse_script.py and light_plan.py on it, and checks the result with the bridge's own validation
(`pnpm eos-bridge --list`).
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PARSER = REPO / ".claude/skills/check-script-updates/parse_script.py"
PLAN = HERE / "light_plan.py"

Y = 'style="background-color:#ffff00"'  # yellow highlight: Licht / Bühne
M = 'style="background-color:#ff00ff"'  # magenta: Code


def cell(*paras):
    return "<td>" + "".join(f"<p>{p}</p>" for p in paras) + "</td>"


EXPORT = f"""<html><body>
<p><span>Legende</span></p>
<table>
<tr>{cell('Lichtstimmung')}{cell('Lampen')}{cell('Fade')}</tr>
<tr>{cell('vier felder')}{cell('Feld rot: rot 100 · Feld blau: blau 100 · Feld grün: grün 100')}{cell('2 s')}</tr>
<tr>{cell('Aus')}{cell('alle: aus')}{cell('3')}</tr>
<tr>{cell('dämmer')}{cell('alle: abend 20')}{cell('')}</tr>
</table>
<table>
<tr>{cell('Lichtfarbe')}{cell('Mischung')}</tr>
<tr>{cell('Abend')}{cell('rot 100 · grün 30 · amber 80')}</tr>
</table>
<table>
<tr>{cell('T1.1.v1 Eins', 'Text eins.', f'<span {Y}>[LICHT: vier-felder]</span>')}{cell('')}</tr>
<tr>{cell('T1.2.v1 Zwei', f'<span {M}>[Code] Abstimmung.</span>', f'<span {Y}>LICHT Gewinner</span>')}{cell('')}</tr>
<tr>{cell('T1.3.v2 Drei', f'<span {Y}>[LICHT: Zuschauerraum hell; Bühne dunkel.]</span>', f'<span {Y}>LICHT Pult: kurzer Blitz auf die Bühne</span>', f'<span {Y}>Licht hebt die Gruppe hervor.</span>')}{cell('')}</tr>
<tr>{cell('T1.4.v1 Vier', f'<span {Y}>LICHT: aus</span>', f'<span {Y}>LICHT: gibts-nicht</span>')}{cell('')}</tr>
</table>
</body></html>"""

VENUE = {
    "eos": {"host": "10.0.0.1"},
    "fixtures": {"feld-rot": {"channel": 12}, "feld-blau": {"channel": 13}, "feld-gruen": {"channel": 10}, "feld-gelb": {"channel": 11}},
    "palette": {"rot": {"red": 100}, "blau": {"blue": 100}, "gruen": {"green": 100}, "gelb": {"red": 100, "green": 55, "amber": 100}},
    "looks": {"aus": {"fade": 3, "fixtures": {"*": {"level": 0}}}, "eigen": {"fixtures": {"*": {"level": 50}}}},
    "cues": {"licht-alt": "aus", "musik-start": "aus"},
    "showEnd": "aus",
}
MAPPING = {
    "scenes": {"T1.1": "T1-1-eins", "T1.2": "T1-2-zwei", "T1.3": "T1-3-drei", "T1.4": "T1-4-vier"},
    "winners": {"T1.2": {"q1": "feld-rot", "q2": "feld-blau", "q3": "Feld grün", "q4": "feld-gelb"}},
}


class LightPlan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        (cls.dir / "export.html").write_text(EXPORT, encoding="utf-8")
        (cls.dir / "venue.json").write_text(json.dumps(VENUE), encoding="utf-8")
        (cls.dir / "mapping.json").write_text(json.dumps(MAPPING), encoding="utf-8")
        subprocess.run([sys.executable, "-I", str(PARSER), str(cls.dir / "export.html"), str(cls.dir / "parsed.json")], check=True, capture_output=True)
        cls.parsed = json.loads((cls.dir / "parsed.json").read_text(encoding="utf-8"))
        cls.plan_run = subprocess.run([sys.executable, "-I", str(PLAN), str(cls.dir / "parsed.json"), str(cls.dir / "venue.json"),
                                  str(cls.dir / "mapping.json"), str(cls.dir / "out")], capture_output=True, text=True)
        cls.lighting = json.loads((cls.dir / "out/lighting.json").read_text(encoding="utf-8"))
        cls.phase_cues = json.loads((cls.dir / "out/phase-cues.json").read_text(encoding="utf-8"))
        cls.report = (cls.dir / "out/light-plan.md").read_text(encoding="utf-8")

    def test_parser_finds_cues_by_kind(self):
        kinds = [(c["scene"], c["kind"]) for c in self.parsed["lightCues"]]
        self.assertEqual(kinds, [("T1.1", "look"), ("T1.2", "winner"), ("T1.3", "prose"), ("T1.3", "operator"), ("T1.4", "look"), ("T1.4", "look")])
        self.assertEqual(self.parsed["lightCues"][0]["look"], "vier-felder")

    def test_stage_directions_are_not_cues(self):
        texts = [c["text"] for c in self.parsed["lightCues"]]
        self.assertFalse(any("hebt" in text for text in texts))

    def test_parser_reads_the_tables(self):
        self.assertEqual([row[0] for row in self.parsed["lightLooks"]], ["vier felder", "Aus", "dämmer"])
        self.assertEqual(self.parsed["lightColours"], [["Abend", "rot 100 · grün 30 · amber 80"]])

    def test_looks_colours_and_cues(self):
        looks = self.lighting["looks"]
        self.assertEqual(looks["vier-felder"], {"fixtures": {"feld-rot": {"color": "rot", "level": 100}, "feld-blau": {"color": "blau", "level": 100},
                                                             "feld-gruen": {"color": "gruen", "level": 100}}, "fade": 2.0})
        self.assertEqual(looks["aus"], {"fade": 3.0, "fixtures": {"*": {"level": 0}}})  # the script's version wins
        self.assertEqual(looks["daemmer"], {"fixtures": {"*": {"color": "abend", "level": 20.0}}})
        self.assertEqual(looks["eigen"], VENUE["looks"]["eigen"])  # hand-made looks stay
        self.assertEqual(self.lighting["palette"]["abend"], {"red": 100.0, "green": 30.0, "amber": 80.0})
        self.assertEqual(self.lighting["cues"], {"musik-start": "aus", "licht-vier-felder": "vier-felder", "licht-aus": "aus"})
        self.assertEqual(self.phase_cues, {"T1-1-eins": ["licht-vier-felder"], "T1-4-vier": ["licht-aus"]})

    def test_vote_winner_lights_its_field(self):
        self.assertEqual(self.lighting["results"]["T1-2-zwei"], {"q1": "gewinner-feld-rot", "q2": "gewinner-feld-blau", "q3": "gewinner-feld-gruen", "q4": "gewinner-feld-gelb"})
        self.assertEqual(self.lighting["looks"]["gewinner-feld-blau"], {"fade": 1.5, "fixtures": {"*": {"level": 10}, "feld-blau": {"level": 100}}})

    def test_venue_part_is_kept(self):
        for key in ("eos", "fixtures", "showEnd"):
            self.assertEqual(self.lighting[key], VENUE[key])

    def test_report_lists_operator_cues_and_problems(self):
        self.assertEqual(self.plan_run.returncode, 1)
        self.assertIn("kurzer Blitz auf die Bühne", self.report)
        self.assertIn("written as prose", self.report)
        self.assertIn("gibts-nicht — no Lichtstimmung", self.report)

    def test_the_bridge_accepts_the_file(self):
        result = subprocess.run(["pnpm", "--silent", "eos-bridge", "--config", str(self.dir / "out/lighting.json"), "--list"],
                                cwd=REPO, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("vote T1-2-zwei → q1 → gewinner-feld-rot", result.stdout)



def parse(export):
    folder = Path(tempfile.mkdtemp())
    (folder / "export.html").write_text(export, encoding="utf-8")
    subprocess.run([sys.executable, "-I", str(PARSER), str(folder / "export.html"), str(folder / "parsed.json")], check=True, capture_output=True)
    return json.loads((folder / "parsed.json").read_text(encoding="utf-8"))


def plan(parsed, venue, mapping):
    folder = Path(tempfile.mkdtemp())
    for name, data in (("parsed.json", parsed), ("venue.json", venue), ("mapping.json", mapping)):
        (folder / name).write_text(json.dumps(data), encoding="utf-8")
    subprocess.run([sys.executable, "-I", str(PLAN), *(str(folder / n) for n in ("parsed.json", "venue.json", "mapping.json")), str(folder / "out")], capture_output=True)
    return json.loads((folder / "out/lighting.json").read_text(encoding="utf-8"))


class ScriptLayout(unittest.TestCase):
    """Where cues sit in the real script's two-column table (Astra review)."""

    def cues(self, rows):
        parsed = parse("<html><body><p>Legende</p><table>" + "".join(rows) + "</table></body></html>")
        return [(c["scene"], c["kind"], c.get("look")) for c in parsed["lightCues"]]

    def test_two_cues_split_by_a_line_break(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins', f'<span {Y}>LICHT: aus<br>LICHT Gewinner</span>')}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.1", "look", "aus"), ("T1.1", "winner", None)])

    def test_cue_next_to_other_text(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins', f'<span {Y}>LICHT: aus</span><span>Text</span><span {Y}>LICHT: an</span>')}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.1", "look", "aus"), ("T1.1", "look", "an")])

    def test_cue_in_the_other_column_of_the_scene_row(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins')}{cell('')}</tr>",
                f"<tr>{cell(f'<span {Y}>LICHT: aus</span>')}{cell('T1.2.v1 Zwei')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.2", "look", "aus")])

    def test_cue_in_a_cell_without_heading_belongs_to_the_last_scene(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins')}{cell('')}</tr>", f"<tr>{cell(f'<span {Y}>LICHT: aus</span>')}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.1", "look", "aus")])

    def test_cue_without_heading_prefers_its_own_column(self):
        rows = [f"<tr>{cell('K1.1.v1 Links')}{cell('')}</tr>", f"<tr>{cell('')}{cell('T1.1.v1 Rechts')}</tr>",
                f"<tr>{cell(f'<span {Y}>LICHT: aus</span>')}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("K1.1", "look", "aus")])

    def test_heading_after_a_line_break(self):
        rows = [f"<tr>{cell('T1.1.v1 Eins', 'Ende der Szene.<br>T1.2.v3 Zwei<br>' + f'<span {Y}>LICHT: aus</span>')}{cell('')}</tr>"]
        self.assertEqual(self.cues(rows), [("T1.2", "look", "aus")])


class Reruns(unittest.TestCase):
    def test_a_winner_cue_removed_from_the_script_is_gone_after_the_next_run(self):
        first = plan({"lightCues": [{"scene": "T1.2", "kind": "winner", "text": "LICHT Gewinner"}]}, VENUE, MAPPING)
        self.assertIn("T1-2-zwei", first["results"])
        hand_made = {**first, "results": {**first["results"], "andere-wahl": {"q1": "eigen"}}}
        second = plan({"lightCues": []}, hand_made, MAPPING)
        self.assertNotIn("T1-2-zwei", second["results"])
        self.assertFalse(any(name.startswith("gewinner-") for name in second["looks"]))
        self.assertEqual(second["results"], {"andere-wahl": {"q1": "eigen"}})  # hand-made vote entries stay

    def test_a_look_cue_removed_from_the_script_is_gone_after_the_next_run(self):
        first = plan({"lightCues": [{"scene": "T1.1", "kind": "look", "look": "aus", "text": "aus"}]}, VENUE, MAPPING)
        self.assertIn("licht-aus", first["cues"])
        second = plan({"lightCues": []}, first, MAPPING)
        self.assertNotIn("licht-aus", second["cues"])
        self.assertIn("musik-start", second["cues"])

if __name__ == "__main__":
    unittest.main(verbosity=2)
