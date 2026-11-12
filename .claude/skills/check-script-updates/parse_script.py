#!/usr/bin/env python3
"""Turn a Google Docs HTML export of the show script into colour-tagged JSON.

Usage: python3 -I parse_script.py <export.html> <out.json>

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

The mapping below reflects the legend as of 2026-11. If the legend in the
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
HIGHLIGHT_CUE = {
    "#00ff00": "video",
    "#93c47d": "monitor",
    "#6aa84f": "monitor",
    "#ffff00": "light-stage",
    "#00ffff": "music",
    "#ff00ff": "code",
    "#d9ead3": "vox-ready",   # light-green heading: section can be recorded
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
        self.span_stack = []
        self.para = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.table_depth += 1
            self.seen_table = True
        elif tag == "tr" and self.table_depth:
            self.row += 1
            self.col = -1
        elif tag == "td" and self.table_depth:
            self.col += 1
        elif tag in ("p", "h1", "h2", "h3", "h4", "li"):
            self.para = {"row": self.row if self.table_depth else None,
                         "col": self.col if self.table_depth else None,
                         "runs": []}
        elif tag == "span":
            self.span_stack.append(style_of(a.get("style", "")))
        elif tag == "br" and self.para is not None:
            self.para["runs"].append({"text": "\n"})

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


def main():
    src, dst = sys.argv[1], sys.argv[2]
    p = Parser()
    p.feed(open(src, encoding="utf-8").read())
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

    json.dump({"legend": p.legend, "paragraphs": p.paragraphs, "scenes": scenes,
               "versionedIds": list(versioned.values()),
               "unmappedColours": [list(u) for u in unknown]},
              open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(p.paragraphs)} paragraphs, {len(scenes)} scenes, "
          f"{len(unknown)} unmapped colour pairs -> {dst}")


if __name__ == "__main__":
    main()
