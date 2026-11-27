#!/usr/bin/env python3
"""Turn the show script (Google Docs HTML export or .docx) into colour-tagged JSON.

Usage: python3 -I parse_script.py <export.html | script.docx> <out.json>

Output: {"legend": [...], "paragraphs": [...], "scenes": [...]}

- legend: paragraphs before the first table, with their raw colours, so the
  colour meaning can be checked against what the script itself says.
- paragraphs: every paragraph in reading order with row/column of the table
  cell it sits in (column 0 = left, column 1 = right), and its runs. Each run
  has text, raw `color`/`bg` hex and the mapped `status` (text colour) and
  `cue` (highlight) from the tables below. Struck-through text has `struck: true`: the script
  cuts a scene by striking it through.
- scenes: paragraphs grouped under scene headings such as "K0.1.v2 ..." or
  "T1.2 — ...", with the heading's version number and the set of statuses and
  cues found inside. `struck` is true when the whole heading is struck through (the scene is
  cut); `struckParagraphs` counts the scene's paragraphs that are struck through entirely.
- fieldGrids: the 2×2 tables inside the script table, in reading order. Each cell is a stage
  field: monitor Mn, lit by lamp Ln. The legend's grid (a top-level 2×2 whose cells are labelled
  M3/L3 …) says which field sits where (`fieldLayout`). Per grid: `scene`, `paragraph`, `before`
  (the line above it), and `fields` {"M1": {"lamp": "L1", "text": monitor text, "colour": name}}.
  Labels ("M3:", "M3 ", "M3/L3 Warm:") are stripped; the colour comes from yellow text in the
  cell ("(Warm)") or the label. `colours` is "own", or "carried" when the grid gives none and keeps
  those of the grid at `coloursFrom`. Grids of numbers only are instructions (`instructionGrids`).
- lightCues: light written in the yellow highlight (docs/script-light-cues.md), one per line:
  - kind "set": `Licht: L1+L3: Warm L2+L4: off`, `Licht: L4+L1 Warm, L2+L3 off`,
    `Licht: 50% Warm auf L1-L4`, `L1-L4 Warm 100%`, `Warm on lights 1-4`, and every grid with its
    own colours (`source: "grid"`). `parts` lists the lamps (numbers, or "*" for alle) and the
    settings text for each group; light_plan.py checks the settings. Text after a comma that names
    no lamp (`, Saal hell`) is `rest` and also a prose cue.
  - kind "winner": "Die gewählte Gruppe wird durch Licht hervorgehoben (andere … auf 25% …)",
    with `others`, the level of the fields that did not win (null when not written).
    `fieldColours` holds each lamp's colour from the last grid before it.
  - kind "prose": any other yellow line that mentions light, a lamp (L1-L4) or a colour from the
    colour table: a note for the operator. Yellow light text is never dropped.
  Each cue belongs to the scene heading above it in the same table cell, else to a heading in
  the same table row (the other column), else to the last heading in the same column (the K and
  T sides run in separate columns), else to the last heading before it.
- lightColours: rows of the colour table (a table whose header row names the emitters Red,
  Green, Blue, Amber, Mint): {"name": first cell, "values": {header: cell text}}.
- problems: grid labels that contradict the legend layout, colours missing from the colour
  table, grids that colour only some fields.

Rows and columns are counted per table, so a grid inside a cell never shifts the script table.

A .docx is read directly (Word highlight and shading become the same hex colours as in the
HTML export). The mapping below reflects the legend as of 2026-11. If the legend in the
script changes, the skill tells the agent to trust the script over this table.
Only the standard library is used; the input is untrusted, nothing is executed.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser

TEXT_STATUS = {
    "#000000": "final",       # black: final, recording exists
    "#ff0000": "unrevised",   # red: content not yet revised
    "#9900ff": "change",      # purple: approved change, take into a new recording
}
LIGHT_BG = "#ffff00"
HIGHLIGHT_CUE = {
    "#00ff00": "video",
    "#93c47d": "monitor",
    "#6aa84f": "monitor",
    "#ffff00": "light-stage",
    "#00ffff": "music",
    "#ff00ff": "code",
    "#d9ead3": "vox-ready",   # light-green heading: section can be recorded
}
# Light in the yellow highlight. A lamp group is L1, L1+L3, L1-L4, "L1, L2" or "alle".
LAMPS = r"(?:L\s*\d+(?:\s*(?:\+|,|&|-|–|bis|und)\s*L?\s*\d+)*|alle(?:\s+(?:4|vier))?)"
LIGHT_PREFIX_RE = re.compile(r"^\W*licht\s*:\s*(.*?)[\s\].;]*$", re.I)
# "50% Warm auf L1-L4", "Warm on lights 1-4"
ON_LAMPS_RE = re.compile(rf"^(.+?)\s+(?:auf|on|für)\s+(?:(?:die\s+)?(?:lights?|lampen?)\s+(L?\s*\d+(?:\s*(?:\+|,|&|-|–|bis|und)\s*L?\s*\d+)*)|({LAMPS}))$", re.I)
# A lamp group at the start of a cue or after a separator: "L1+L3:", "L4+L1 Warm", "alle:".
GROUP_RE = re.compile(rf"(?:^|(?<=[\s,;/]))({LAMPS})(?:\s*:|(?=\s|$))", re.I)
MAX_SETTING_WORDS = 3  # colour, level, fade: "50% Warm 2s". Longer is a sentence about the lamps, not a cue.
LAMP_MENTION_RE = re.compile(r"(?<![\w/])L\s*[1-9]\b")
WINNER_RE = re.compile(r"gew[äa]hlte\s+(?:Gruppe|Feld)\b[^.]*\blicht\b[^.]*\b(?:hervorgehoben|markiert)", re.I)
WINNER_LEVEL_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")
MENTIONS_LIGHT_RE = re.compile(r"(?<!pf)(?<!sch)licht", re.I)  # Bühnenlicht, Orientierungslicht; not Pflicht, schlicht
EMITTER_HEADERS = {"red", "rot", "green", "grün", "gruen", "blue", "blau", "amber", "mint"}
HIGHLIGHT_HEX = {  # Word highlight names, as Google Docs writes them into a .docx
    "yellow": "#ffff00", "green": "#00ff00", "cyan": "#00ffff", "magenta": "#ff00ff", "blue": "#0000ff",
    "red": "#ff0000", "darkBlue": "#000080", "darkCyan": "#008080", "darkGreen": "#008000",
    "darkMagenta": "#800080", "darkRed": "#800000", "darkYellow": "#808000", "darkGray": "#808080",
    "lightGray": "#c0c0c0", "black": "#000000", "white": "#ffffff",
}
# "K0 — ...", "K0.1.v2 ...", "T1.0.1.v2", "KI_NTROv3 — ...": ID plus optional version.
SCENE_RE = re.compile(r"^\s*(KI_NTRO|[KT]\d+(?:\.\d+)*)(?:\.?v(\d+))?\.?(?=[\s—–:-]|$)")


def style_of(attr: str) -> dict:
    out = {}
    for decl in attr.split(";"):
        if ":" not in decl:
            continue
        k, v = decl.split(":", 1)
        out[k.strip().lower()] = v.strip().lower()
    return out


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.legend, self.paragraphs = [], []
        self.stack = []      # one entry per open table: {"id", "row", "col"}; [0] is the outer table
        self.shapes = {}     # table id -> cells per row, to find 2×2 grids
        self.depth_of = {}   # table id -> nesting depth (1 = top level)
        self.seen_table = False
        self.table = -1      # top-level table counter
        self.tables = 0      # every table, at any depth
        self.span_stack = []
        self.para = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            # Rows and columns are counted per table: a grid inside a cell of the script table
            # must not move the script table's own row and column.
            if not self.stack:
                self.table += 1
            tid = self.tables
            self.tables += 1
            self.stack.append({"id": tid, "top": self.table, "row": -1, "col": -1})
            self.shapes[tid] = []
            self.depth_of[tid] = len(self.stack)
            self.seen_table = True
        elif tag == "tr" and self.stack:
            self.stack[-1]["row"] += 1
            self.stack[-1]["col"] = -1
            self.shapes[self.stack[-1]["id"]].append(0)
        elif tag == "td" and self.stack:
            self.stack[-1]["col"] += 1
            if self.shapes[self.stack[-1]["id"]]:
                self.shapes[self.stack[-1]["id"]][-1] += 1
        elif tag in ("p", "h1", "h2", "h3", "h4", "li"):
            outer = self.stack[0] if self.stack else None
            self.para = {"table": outer["top"] if outer else None,
                         "row": outer["row"] if outer else None,
                         "col": outer["col"] if outer else None,
                         "runs": [], "_segments": []}
            if self.stack:  # the innermost table cell, for grids
                inner = self.stack[-1]
                self.para["_cell"] = (inner["id"], inner["row"], inner["col"])
        elif tag == "span":
            self.span_stack.append(style_of(a.get("style", "")))
        elif tag == "br" and self.para is not None:
            self.para["runs"].append({"text": "\n"})
            self.para["_segments"].append(("\n", False))

    def handle_endtag(self, tag):
        if tag == "table" and self.stack:
            self.stack.pop()
        elif tag == "span" and self.span_stack:
            self.span_stack.pop()
        elif tag in ("p", "h1", "h2", "h3", "h4", "li") and self.para is not None:
            text = "".join(r["text"] for r in self.para["runs"]).strip()
            if text:
                self.para["text"] = text
                (self.paragraphs if self.seen_table else self.legend).append(self.para)
            self.para = None

    def handle_data(self, data):
        if self.para is None or not data:
            return
        st = self.span_stack[-1] if self.span_stack else {}
        color = st.get("color")
        bg = st.get("background-color")
        run = {"text": data}
        if "line-through" in st.get("text-decoration", ""):
            run["struck"] = True
        if color:
            run["color"] = color
            if color in TEXT_STATUS:
                run["status"] = TEXT_STATUS[color]
        # Line breaks and highlight changes survive here (merge_runs drops whitespace-only runs).
        self.para["_segments"].append((data, bg == LIGHT_BG))
        if bg and bg != "#ffffff":
            run["bg"] = bg
            if bg in HIGHLIGHT_CUE:
                run["cue"] = HIGHLIGHT_CUE[bg]
        self.para["runs"].append(run)


def is_struck(para):
    """True when every visible run of the paragraph is struck through."""
    runs = [r for r in para["runs"] if r["text"].strip()]
    return bool(runs) and all(r.get("struck") for r in runs)


def merge_runs(runs):
    merged = []
    for r in runs:
        key = (r.get("color"), r.get("bg"), r.get("struck", False))
        if merged and (merged[-1].get("color"), merged[-1].get("bg"), merged[-1].get("struck", False)) == key:
            merged[-1]["text"] += r["text"]
        else:
            merged.append(dict(r))
    return [r for r in merged if r["text"].strip()]


LINE_SCENE_RE = re.compile(r"^\s*(KI_NTRO|[KT]\d+(?:\.\d+)*)(?:\.?v\d+)?\.?(?=[\s—–:-]|$)")


def lines_of(para):
    """The paragraph as lines, each (full text, yellow text). A highlight change also ends a yellow piece."""
    lines, full, yellow = [], [], []
    for text, is_yellow in para["_segments"]:
        for i, part in enumerate(text.split("\n")):
            if i:
                lines.append(("".join(full), "".join(yellow)))
                full, yellow = [], []
            full.append(part)
            yellow.append(part if is_yellow else "\n")
    lines.append(("".join(full), "".join(yellow)))
    return lines


def lamp_numbers(text):
    """"L1+L3" -> [1, 3], "L1-L4" -> [1, 2, 3, 4], "alle" -> ["*"]."""
    if text.strip().lower().startswith("alle"):
        return ["*"]
    numbers = []
    for part in re.split(r"\s*(?:\+|,|&|und)\s*", text, flags=re.I):
        bounds = [int(n) for n in re.findall(r"\d+", part)]
        if len(bounds) == 2 and re.search(r"-|–|bis", part):
            numbers += range(min(bounds), max(bounds) + 1)
        else:
            numbers += bounds
    return sorted(set(numbers))


def light_cue(text):
    """One yellow line -> a cue: lamps with settings, a vote winner, or prose."""
    body = LIGHT_PREFIX_RE.match(text)
    body = body.group(1).strip() if body else text.strip().strip("[]").strip()
    groups = list(GROUP_RE.finditer(body))
    if groups and not body[:groups[0].start()].strip():
        parts, rest = [], []
        for n, g in enumerate(groups):
            settings = body[g.end():groups[n + 1].start() if n + 1 < len(groups) else len(body)]
            # "L1-4 off, Saal hell": what follows a comma without lamps is for the operator.
            first, *more = [piece.strip(" ·") for piece in re.split(r"[,;]", settings)]
            parts.append({"lamps": lamp_numbers(g.group(1)), "settings": first})
            rest += [piece for piece in more if piece]
        if any(len(part["settings"].split()) > MAX_SETTING_WORDS for part in parts):
            return {"kind": "prose", "text": text}  # "L1+L2 markieren die vordere Zone": a description
        cue = {"kind": "set", "text": text, "parts": parts}
        if rest:
            cue["rest"] = ", ".join(rest)
        return cue
    on = ON_LAMPS_RE.match(body)
    if on and len(on.group(1).split()) <= MAX_SETTING_WORDS:
        return {"kind": "set", "text": text, "parts": [{"lamps": lamp_numbers(on.group(2) or on.group(3)), "settings": on.group(1).strip()}]}
    if WINNER_RE.search(text):
        level = WINNER_LEVEL_RE.search(text)
        return {"kind": "winner", "text": text, "others": float(level.group(1).replace(",", ".")) if level else None}
    return {"kind": "prose", "text": text}


def scene_walk(paragraphs):
    """For each paragraph, its lines as (full text, yellow text, scene the line belongs to).

    A line belongs to the scene heading above it in the same table cell, else to a heading in the
    same table row (the other column), else to the last heading in the same column (the K and T
    sides run in separate columns), else to the last heading before it."""
    # Any line that starts with a scene ID is a heading here, also long ones such as
    # "K1.1.7.v4 (war K1.1.6.v3) Kopfhörer: ..." that hold the scene's first sentence.
    row_scene = {}
    for para in paragraphs:
        if para.get("table") is None:
            continue
        for full, _ in lines_of(para):
            m = LINE_SCENE_RE.match(full)
            if m:
                row_scene.setdefault((para["table"], para["row"]), m.group(1))
    walked, last_scene, cell, cell_scene, last_in_column = [], None, None, None, {}
    for para in paragraphs:
        here = (para.get("table"), para.get("row"), para.get("col"))
        if here != cell:
            cell, cell_scene = here, None
        lines = []
        for full, yellow in lines_of(para):
            m = LINE_SCENE_RE.match(full)
            if m:
                cell_scene = last_scene = last_in_column[para.get("col")] = m.group(1)
            scene = (cell_scene or row_scene.get((para.get("table"), para.get("row")))
                     or last_in_column.get(para.get("col")) or last_scene)
            lines.append((full, yellow, scene))
        walked.append(lines)
    return walked


def is_light_text(piece, colour_names):
    """Yellow text that is about the light: names it, a lamp (L1-L4) or a colour from the colour table."""
    words = {w.lower() for w in re.findall(r"[\wäöüÄÖÜß]+", piece)}
    return bool(MENTIONS_LIGHT_RE.search(piece) or LAMP_MENTION_RE.search(piece)
                or ON_LAMPS_RE.match(piece) or words & set(colour_names))


def light_cues(paragraphs, walked, skip, colour_names):
    """Light cues in yellow text, in reading order, with the scene each belongs to.

    `skip`: paragraphs that are not script lines (colour table, legend and field grids).
    Yellow text about light that is not a cue is kept as an operator note, never dropped."""
    cues = []
    for i, para in enumerate(paragraphs):
        if i in skip:
            continue
        for full, yellow, scene in walked[i]:
            found = [light_cue(piece.strip()) for piece in yellow.split("\n")
                     if piece.strip() and is_light_text(piece, colour_names)]
            exact = [cue for cue in found if cue["kind"] != "prose"]
            if not exact:
                if found:  # a note for the operator: the whole line, not only its yellow part
                    cues.append({"scene": scene, "paragraph": i, "kind": "prose", "text": full.strip()})
                continue
            for cue in found:
                cues.append({"scene": scene, "paragraph": i, **cue})
                if cue.get("rest"):
                    cues.append({"scene": scene, "paragraph": i, "kind": "prose", "text": cue["rest"], "line": cue["text"]})
    return cues


GRID_LABEL_RE = re.compile(r"^\s*M\s*([1-9])\s*(?:/\s*L\s*([1-9]))?\s*([^:()\n]*?)\s*:\s*", re.I)
BARE_LABEL_RE = re.compile(r"^\s*M\s*([1-9])(?:\s*/\s*L\s*([1-9]))?(?:\s*[–-])?\s+", re.I)  # "M1 Eine Frage?"
LEGEND_LABEL_RE = re.compile(r"^\s*M\s*([1-9])\b", re.I)
DEFAULT_LAYOUT = {(0, 0): "M3", (0, 1): "M2", (1, 0): "M4", (1, 1): "M1"}


def grids_of(paragraphs, shapes, depth_of):
    """2×2 tables -> {table id: {"depth", "first": paragraph index, "cells": {(row, col): [paragraph, ...]}}}."""
    grids = {}
    for i, para in enumerate(paragraphs):
        cell = para.get("_cell")
        if not cell or shapes.get(cell[0]) != [2, 2]:
            continue
        grid = grids.setdefault(cell[0], {"depth": depth_of[cell[0]], "first": i, "cells": {}})
        grid["cells"].setdefault(cell[1:], []).append(para)
    return grids


def field_layout(grids, problems):
    """Which field sits in which grid cell, from the first grid that labels all four (the legend's)."""
    for grid in sorted(grids.values(), key=lambda g: (g["depth"], g["first"])):
        labels = {}
        for pos, paras in grid["cells"].items():
            m = LEGEND_LABEL_RE.match(paras[0]["text"])
            if m:
                labels[pos] = "M" + m.group(1)
        if len(labels) == 4 and len(set(labels.values())) == 4:
            return labels
    problems.append("no grid labels all four fields (M3/L3 …); assuming M3 M2 / M4 M1")
    return dict(DEFAULT_LAYOUT)


def grid_field(paras, field, colour_names, where, problems):
    """One grid cell -> (monitor text, colour name or None). Strips the "M3:" / "M3/L3 Warm:" label."""
    colours = []
    lines = []
    for para in paras:
        line = []
        for run in para["runs"]:
            piece = run["text"]
            if run.get("bg") == LIGHT_BG and piece.strip():
                name = piece.strip().strip("()[]").strip()
                if name.lower() in colour_names:
                    colours.append(colour_names[name.lower()])
                    continue
                problems.append(f"{where}: yellow \"{piece.strip()}\" is not a colour from the colour table")
            line.append(piece)
        lines.append("".join(line))
    text = "\n".join(lines).replace("\xa0", " ")
    label = GRID_LABEL_RE.match(text)
    if not label:
        bare = BARE_LABEL_RE.match(text)
        if bare:
            if f"M{bare.group(1)}" != field:
                problems.append(f"{where}: labelled M{bare.group(1)}, but the legend puts {field} in this position")
            text = text[bare.end():]
    if label:
        if f"M{label.group(1)}" != field:
            problems.append(f"{where}: labelled M{label.group(1)}, but the legend puts {field} in this position")
        if label.group(2) and label.group(2) != field[1:]:
            problems.append(f"{where}: labelled M{label.group(1)}/L{label.group(2)}; field Mn is lit by Ln")
        word = label.group(3).strip()
        if word:
            if word.lower() in colour_names:
                colours.append(colour_names[word.lower()])
            else:
                problems.append(f"{where}: \"{word}\" in the label is not a colour from the colour table")
        text = text[label.end():]

    def in_parens(m):
        colours.append(colour_names[m.group(1).lower()])
        return ""
    if colour_names:
        names = "|".join(re.escape(n) for n in sorted(colour_names, key=len, reverse=True))
        text = re.sub(rf"\(\s*({names})\s*\)", in_parens, text, flags=re.I)
    text = re.sub(r"\(\s*\)", "", text)
    text = "\n".join(" ".join(line.split()) for line in text.split("\n"))
    text = "\n".join(line for line in text.split("\n") if line)
    if len(set(colours)) > 1:
        problems.append(f"{where}: two colours ({', '.join(colours)})")
    return text, (colours[0] if colours else None)


def field_grids(paragraphs, grids, layout, walked, colour_names, problems):
    """The script's 2×2 field grids inside the scenes: monitor text and colour per field.

    Field Mn is monitor Mn and lit by lamp Ln. A grid without colours keeps the colours of the
    grid before it. Grids outside the script table (the legend) and grids of numbers only (an
    instruction, such as the lamps' desk channels) are not cues."""
    out, instructions, carried, carried_from = [], [], {}, None
    for grid in sorted(grids.values(), key=lambda g: g["first"]):
        if grid["depth"] == 1:
            continue
        first = grid["first"]
        scene = walked[first][0][2] if walked[first] else None
        texts = {pos: " ".join(p["text"] for p in paras) for pos, paras in grid["cells"].items()}
        if all(re.fullmatch(r"[\d\s.,/+-]*", t) for t in texts.values()):
            instructions.append({"scene": scene, "paragraph": first, "cells": {layout[pos]: t for pos, t in texts.items() if pos in layout}})
            continue
        fields, own = {}, {}
        for pos, field in sorted(layout.items(), key=lambda kv: kv[1]):
            where = f"{scene}: field grid at paragraph {first}, {field}"
            text, colour = grid_field(grid["cells"].get(pos, []), field, colour_names, where, problems)
            fields[field] = {"lamp": "L" + field[1:], "text": text}
            if colour:
                own[field] = colour
        if own:
            missing = [f for f in fields if f not in own]
            if missing:
                problems.append(f"{scene}: field grid at paragraph {first} gives no colour for {', '.join(missing)}")
            carried, carried_from = own, first
        for field in fields:
            fields[field]["colour"] = carried.get(field)
        before = paragraphs[first - 1] if first else None
        out.append({"scene": scene, "paragraph": first,
                    "before": before["text"] if before and not before.get("_cell", (None,))[0] in grids
                    and (before.get("table"), before.get("row"), before.get("col")) == (paragraphs[first].get("table"), paragraphs[first].get("row"), paragraphs[first].get("col")) else None,
                    "colours": "own" if own else ("carried" if carried else None),
                    "coloursFrom": carried_from if carried else None,
                    "fields": fields})
    return out, instructions


def grid_light_cues(grids):
    """A grid that gives its own colours sets each field's lamp to that colour."""
    cues = []
    for grid in grids:
        if grid["colours"] != "own":
            continue
        lit = sorted((int(f[1:]), v["colour"]) for f, v in grid["fields"].items() if v["colour"])
        cues.append({"scene": grid["scene"], "paragraph": grid["paragraph"], "kind": "set", "source": "grid",
                     "text": "field grid: " + " · ".join(f"L{n} {c}" for n, c in lit),
                     "parts": [{"lamps": [n], "settings": c} for n, c in lit]})
    return cues


def colour_table(paragraphs):
    """Rows of every table whose header row names at least three emitters (Red, Green, Blue, ...),
    and the indexes of those tables."""
    cells = {}
    for para in paragraphs:
        if para.get("table") is None:
            continue
        key = (para["table"], para["row"], para["col"])
        cells[key] = (cells[key] + "\n" + para["text"]) if key in cells else para["text"]
    rows, tables = [], set()
    for table in sorted({t for t, _, _ in cells}):
        keys = [k for k in cells if k[0] == table]
        first_row = min(r for _, r, _ in keys)
        header = {c: cells[(table, first_row, c)].strip() for _, r, c in keys if r == first_row}
        if sum(1 for h in header.values() if h.lower() in EMITTER_HEADERS) < 3:
            continue
        tables.add(table)
        for row in sorted({r for _, r, _ in keys if r != first_row}):
            name = cells.get((table, row, 0), "").strip()
            if name:
                rows.append({"name": name, "values": {header[c]: cells[(table, row, c)].strip()
                                                      for _, r, c in keys if r == row and c in header and c != 0}})
    return rows, tables


def docx_html(path):
    """A .docx as the HTML shape of a Google Docs export: tables, paragraphs, coloured spans."""
    import zipfile
    from xml.etree import ElementTree
    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(path) as z:
        root = ElementTree.fromstring(z.read("word/document.xml"))
    out = []

    def runs(node):
        for child in node:
            if child.tag == w + "r":
                yield child
            elif child.tag not in (w + "del", w + "moveFrom", w + "pPr", w + "rPr"):
                yield from runs(child)

    def paragraph(p):
        style = p.find(f"{w}pPr/{w}pStyle")
        level = re.match(r"Heading([1-4])$", style.get(w + "val", "")) if style is not None else None
        tag = f"h{level.group(1)}" if level else "p"
        out.append(f"<{tag}>")
        for r in runs(p):
            css = []
            color = r.find(f"{w}rPr/{w}color")
            if color is not None and re.fullmatch(r"[0-9A-Fa-f]{6}", color.get(w + "val", "")):
                css.append(f"color:#{color.get(w + 'val').lower()}")
            highlight, shade = r.find(f"{w}rPr/{w}highlight"), r.find(f"{w}rPr/{w}shd")
            bg = HIGHLIGHT_HEX.get(highlight.get(w + "val", "")) if highlight is not None else None
            if bg is None and shade is not None and re.fullmatch(r"[0-9A-Fa-f]{6}", shade.get(w + "fill", "")):
                bg = "#" + shade.get(w + "fill").lower()
            if bg:
                css.append(f"background-color:{bg}")
            strike = [r.find(f"{w}rPr/{w}{tag}") for tag in ("strike", "dstrike")]
            if any(e is not None and e.get(w + "val", "true") not in ("0", "false") for e in strike):
                css.append("text-decoration:line-through")
            text = []
            for child in r:
                if child.tag == w + "t":
                    text.append(html.escape(child.text or ""))
                elif child.tag == w + "tab":
                    text.append("\t")
                elif child.tag in (w + "br", w + "cr"):
                    text.append("<br>")
                elif child.tag == w + "noBreakHyphen":
                    text.append("-")
            if text:
                out.append(f'<span style="{";".join(css)}">{"".join(text)}</span>')
        out.append(f"</{tag}>")

    def block(node):
        for child in node:
            if child.tag == w + "p":
                paragraph(child)
            elif child.tag == w + "tbl":
                out.append("<table>")
                for tr in child.iter(w + "tr"):
                    if tr.find(f"..") is not None:
                        pass
                for tr in child.findall(w + "tr"):
                    out.append("<tr>")
                    for tc in tr.findall(w + "tc"):
                        out.append("<td>")
                        block(tc)
                        out.append("</td>")
                    out.append("</tr>")
                out.append("</table>")
            elif child.tag in (w + "sdt", w + "sdtContent", w + "body"):
                block(child)

    block(root.find(w + "body"))
    return "<html><body>" + "".join(out) + "</body></html>"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    p = Parser()
    p.feed(docx_html(src) if src.lower().endswith(".docx") else open(src, encoding="utf-8").read())
    for para in p.legend + p.paragraphs:
        para["runs"] = merge_runs(para["runs"])

    scenes, current = [], None
    for i, para in enumerate(p.paragraphs):
        para["index"] = i
        m = SCENE_RE.match(para["text"])
        if m and len(para["text"]) < 160:
            current = {"id": m.group(1), "version": m.group(2), "heading": para["text"],
                       "row": para["row"], "col": para["col"], "paragraphs": [],
                       "statuses": set(), "cues": set(), "struck": is_struck(para), "struckParagraphs": 0}
            scenes.append(current)
        if current and (para["row"], para["col"]) == (current["row"], current["col"]):
            current["paragraphs"].append(i)
            current["struckParagraphs"] += is_struck(para)
            for r in para["runs"]:
                if "status" in r:
                    current["statuses"].add(r["status"])
                if "cue" in r:
                    current["cues"].add(r["cue"])
    for s in scenes:
        s["statuses"] = sorted(s["statuses"])
        s["cues"] = sorted(s["cues"])

    unknown = sorted({(r.get("color"), r.get("bg"))
                      for para in p.paragraphs for r in para["runs"]
                      if (r.get("color") and r.get("color") not in TEXT_STATUS)
                      or (r.get("bg") and r.get("bg") not in HIGHLIGHT_CUE)},
                     key=str)
    # Headings often share a paragraph with the previous scene's text, joined by
    # line breaks ("...\nK1.2.1.v3\nKopfhörer:"). List every versioned ID found at
    # the start of any line, so the recording-version check misses none.
    line_re = re.compile(r"^\s*(KI_NTRO|[KT]\d+(?:\.\d+)*)\.?v(\d+)\b", re.M)
    versioned = {}
    for para in p.paragraphs:
        for m in line_re.finditer(para["text"]):
            st = sorted({r["status"] for r in para["runs"] if "status" in r})
            versioned.setdefault((m.group(1), m.group(2)), {"id": m.group(1), "version": m.group(2),
                                                            "paragraph": para["index"], "statuses": st,
                                                            "struck": is_struck(para)})

    problems = []
    colours, colour_tables = colour_table(p.paragraphs)
    colour_names = {row["name"].strip().lower(): row["name"].strip() for row in colours}
    walked = scene_walk(p.paragraphs)
    grids = grids_of(p.paragraphs, p.shapes, p.depth_of)
    layout = field_layout(grids, problems)
    fields, instructions = field_grids(p.paragraphs, grids, layout, walked, colour_names, problems)
    # Not script lines: the colour table, grids inside the script table (read as field grids) and
    # top-level grids whose four cells are labelled M1-M4 (the legend's field layout).
    legend = {tid for tid, g in grids.items() if g["depth"] == 1 and len(g["cells"]) == 4
              and all(LEGEND_LABEL_RE.match(paras[0]["text"]) for paras in g["cells"].values())}
    skip = {i for i, para in enumerate(p.paragraphs)
            if para.get("table") in colour_tables
            or (para.get("_cell") or (None,))[0] in {tid for tid, g in grids.items() if g["depth"] > 1} | legend}
    cues = sorted(light_cues(p.paragraphs, walked, skip, colour_names) + grid_light_cues(fields),
                  key=lambda cue: cue["paragraph"])
    for cue in cues:  # which colour each lamp has when a vote is decided (its field grid)
        if cue["kind"] == "winner":
            before = [g for g in fields if g["paragraph"] < cue["paragraph"] and g["colours"]]
            if before:
                cue["grid"] = before[-1]["paragraph"]
                cue["fieldColours"] = {v["lamp"]: v["colour"] for v in before[-1]["fields"].values()}
    for para in p.legend + p.paragraphs:
        para.pop("_segments", None)
        cell = para.pop("_cell", None)
        if cell and cell[0] in grids and grids[cell[0]]["depth"] > 1:
            para["grid"] = {"row": cell[1], "col": cell[2]}
    json.dump({"legend": p.legend, "paragraphs": p.paragraphs, "scenes": scenes,
               "versionedIds": list(versioned.values()),
               "fieldLayout": [[layout.get((r, c)) for c in (0, 1)] for r in (0, 1)],
               "fieldGrids": fields, "instructionGrids": instructions,
               "struckScenes": [s["id"] for s in scenes if s["struck"]],
               "lightCues": cues, "lightColours": colours, "problems": problems,
               "unmappedColours": [list(u) for u in unknown]},
              open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(p.paragraphs)} paragraphs, {len(scenes)} scenes, {len(fields)} field grids, "
          f"{len(cues)} light cues, {len(colours)} light colours, {len(problems)} problems, "
          f"{len(unknown)} unmapped colour pairs, "
          f"{sum(s['struck'] for s in scenes)} struck-through scenes -> {dst}")


if __name__ == "__main__":
    main()
