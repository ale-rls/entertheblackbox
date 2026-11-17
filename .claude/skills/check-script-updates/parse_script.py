#!/usr/bin/env python3
"""Turn the show script (Google Docs HTML export or .docx) into colour-tagged JSON.

Usage: python3 -I parse_script.py <export.html | script.docx> <out.json>

Output: {"legend": [...], "paragraphs": [...], "scenes": [...]}

- legend: paragraphs before the first table, with their raw colours, so the
  colour meaning can be checked against what the script itself says.
- paragraphs: every paragraph in reading order with row/column of the table
  cell it sits in (column 0 = left, column 1 = right), and its runs. Each run
  has text, raw `color`/`bg` hex and the mapped `status` (text colour) and
  `cue` (highlight) from the tables below.
- scenes: paragraphs grouped under scene headings such as "K0.1.v2 ..." or
  "T1.2 — ...", with the heading's version number and the set of statuses and
  cues found inside.
- lightCues: light written in the yellow highlight (docs/script-light-cues.md), one per line:
  - kind "set": `Licht: L1+L3: Warm L2+L4: off`, `Licht: 50% Warm auf L1-L4`,
    `Warm on lights 1-4`. `parts` lists the lamps (numbers, or "*" for alle) and the settings
    text for each group; light_plan.py checks the settings.
  - kind "winner": "Die gewählte Gruppe wird durch Licht hervorgehoben (andere … auf 25% …)",
    with `others`, the level of the fields that did not win (null when not written).
  - kind "prose": any other yellow line that mentions light: a note for the operator.
  Each cue belongs to the scene heading above it in the same table cell, else to a heading in
  the same table row (the other column), else to the last heading in the same column (the K and
  T sides run in separate columns), else to the last heading before it.
- lightColours: rows of the colour table (a table whose header row names the emitters Red,
  Green, Blue, Amber, Mint): {"name": first cell, "values": {header: cell text}}.

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
ASSIGN_RE = re.compile(rf"({LAMPS})\s*:", re.I)
# "50% Warm auf L1-L4", "Warm on lights 1-4"
ON_LAMPS_RE = re.compile(rf"^(.+?)\s+(?:auf|on|für)\s+(?:(?:die\s+)?(?:lights?|lampen?)\s+(L?\s*\d+(?:\s*(?:\+|,|&|-|–|bis|und)\s*L?\s*\d+)*)|({LAMPS}))$", re.I)
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
SCENE_RE = re.compile(r"^\s*(KI_NTRO|[KT]\d+(?:\.\d+)*)(?:\.?v(\d+))?(?=[\s—–:-]|$)")


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
        self.table_depth = 0
        self.row = -1
        self.col = -1
        self.seen_table = False
        self.table = -1
        self.span_stack = []
        self.para = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.table_depth += 1
            if self.table_depth == 1:
                self.table += 1
            self.seen_table = True
        elif tag == "tr" and self.table_depth:
            self.row += 1
            self.col = -1
        elif tag == "td" and self.table_depth:
            self.col += 1
        elif tag in ("p", "h1", "h2", "h3", "h4", "li"):
            self.para = {"table": self.table if self.table_depth else None,
                         "row": self.row if self.table_depth else None,
                         "col": self.col if self.table_depth else None,
                         "runs": [], "_segments": []}
        elif tag == "span":
            self.span_stack.append(style_of(a.get("style", "")))
        elif tag == "br" and self.para is not None:
            self.para["runs"].append({"text": "\n"})
            self.para["_segments"].append(("\n", False))

    def handle_endtag(self, tag):
        if tag == "table":
            self.table_depth -= 1
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


def merge_runs(runs):
    merged = []
    for r in runs:
        key = (r.get("color"), r.get("bg"))
        if merged and (merged[-1].get("color"), merged[-1].get("bg")) == key:
            merged[-1]["text"] += r["text"]
        else:
            merged.append(dict(r))
    return [r for r in merged if r["text"].strip()]


LINE_SCENE_RE = re.compile(r"^\s*(KI_NTRO|[KT]\d+(?:\.\d+)*)(?:\.?v\d+)?(?=[\s—–:-]|$)")


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
    groups = list(ASSIGN_RE.finditer(body))
    if groups and not body[:groups[0].start()].strip():
        parts = [{"lamps": lamp_numbers(g.group(1)),
                  "settings": body[g.end():groups[n + 1].start() if n + 1 < len(groups) else len(body)].strip(" ,;·")}
                 for n, g in enumerate(groups)]
        return {"kind": "set", "text": text, "parts": parts}
    on = ON_LAMPS_RE.match(body)
    if on:
        return {"kind": "set", "text": text, "parts": [{"lamps": lamp_numbers(on.group(2) or on.group(3)), "settings": on.group(1).strip()}]}
    if WINNER_RE.search(text):
        level = WINNER_LEVEL_RE.search(text)
        return {"kind": "winner", "text": text, "others": float(level.group(1).replace(",", ".")) if level else None}
    return {"kind": "prose", "text": text}


def light_cues(paragraphs):
    """Light cues in yellow text, in reading order, with the scene each belongs to."""
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
    cues, last_scene, cell, cell_scene, last_in_column = [], None, None, None, {}
    for i, para in enumerate(paragraphs):
        here = (para.get("table"), para.get("row"), para.get("col"))
        if here != cell:
            cell, cell_scene = here, None
        for full, yellow in lines_of(para):
            m = LINE_SCENE_RE.match(full)
            if m:
                cell_scene = last_scene = last_in_column[para.get("col")] = m.group(1)
            scene = (cell_scene or row_scene.get((para.get("table"), para.get("row")))
                     or last_in_column.get(para.get("col")) or last_scene)
            found = [light_cue(piece.strip()) for piece in yellow.split("\n")
                     if piece.strip() and (MENTIONS_LIGHT_RE.search(piece) or ON_LAMPS_RE.match(piece.strip()))]
            exact = [cue for cue in found if cue["kind"] != "prose"]
            if exact:
                cues += [{"scene": scene, "paragraph": i, **cue} for cue in exact]
            elif found:  # a note for the operator: the whole line, not only its yellow part
                cues.append({"scene": scene, "paragraph": i, "kind": "prose", "text": full.strip()})
    return cues


def colour_table(paragraphs):
    """Rows of every table whose header row names at least three emitters (Red, Green, Blue, ...)."""
    cells = {}
    for para in paragraphs:
        if para.get("table") is None:
            continue
        key = (para["table"], para["row"], para["col"])
        cells[key] = (cells[key] + "\n" + para["text"]) if key in cells else para["text"]
    rows = []
    for table in sorted({t for t, _, _ in cells}):
        keys = [k for k in cells if k[0] == table]
        first_row = min(r for _, r, _ in keys)
        header = {c: cells[(table, first_row, c)].strip() for _, r, c in keys if r == first_row}
        if sum(1 for h in header.values() if h.lower() in EMITTER_HEADERS) < 3:
            continue
        for row in sorted({r for _, r, _ in keys if r != first_row}):
            name = cells.get((table, row, 0), "").strip()
            if name:
                rows.append({"name": name, "values": {header[c]: cells[(table, row, c)].strip()
                                                      for _, r, c in keys if r == row and c in header and c != 0}})
    return rows


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
                       "statuses": set(), "cues": set()}
            scenes.append(current)
        if current and (para["row"], para["col"]) == (current["row"], current["col"]):
            current["paragraphs"].append(i)
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
                                                            "paragraph": para["index"], "statuses": st})

    cues = light_cues(p.paragraphs)
    for para in p.legend + p.paragraphs:
        para.pop("_segments", None)
    colours = colour_table(p.legend + p.paragraphs)
    json.dump({"legend": p.legend, "paragraphs": p.paragraphs, "scenes": scenes,
               "versionedIds": list(versioned.values()),
               "lightCues": cues, "lightColours": colours,
               "unmappedColours": [list(u) for u in unknown]},
              open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(p.paragraphs)} paragraphs, {len(scenes)} scenes, "
          f"{len(cues)} light cues, {len(colours)} light colours, "
          f"{len(unknown)} unmapped colour pairs -> {dst}")


if __name__ == "__main__":
    main()
