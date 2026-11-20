import { describe, expect, it } from "vitest";
import { MAX_BOUND_TAIL_CHARS, withoutWidows } from "./typography.js";

const NBSP = " ";

describe("monitor text without widows", () => {
  it("binds the last two words of a line of three or more", () => {
    expect(withoutWidows("Wie oft gehst du ins Theater?")).toBe(`Wie oft gehst du ins${NBSP}Theater?`);
    expect(withoutWidows("Bitte schaue auf dein Tablet.")).toBe(`Bitte schaue auf dein${NBSP}Tablet.`);
  });
  it("treats every authored line on its own", () => {
    expect(withoutWidows("2. Trainingsepoche\nVERWANDLUNG")).toBe("2. Trainingsepoche\nVERWANDLUNG");
    expect(withoutWidows("Die Frage hier lautet\nund noch eine Zeile dazu")).toBe(`Die Frage hier${NBSP}lautet\nund noch eine Zeile${NBSP}dazu`);
  });
  it("leaves one- and two-word lines, empty text and trailing spaces alone", () => {
    for (const text of ["", "Nie", "Mehr Mut", "Fast jeden Tag ", "   "]) {
      expect(withoutWidows(text).replaceAll(NBSP, " ")).toBe(text);
    }
    expect(withoutWidows("Mehr Mut")).toBe("Mehr Mut");
    expect(withoutWidows("Fast jeden Tag ")).toBe(`Fast jeden${NBSP}Tag `);
  });
  it("does not bind a final pair too long to fit on one line", () => {
    const long = "Das ist eine Selbstwirksamkeitserwartung Gemeinschaftsgefühl";
    expect(withoutWidows(long)).toBe(long);
    expect("Selbstwirksamkeitserwartung Gemeinschaftsgefühl".length).toBeGreaterThan(MAX_BOUND_TAIL_CHARS);
  });
  it("keeps the visible text identical apart from the bound space", () => {
    const text = "Wie sehr beeinflusst dich, was andere von dir erwarten?";
    expect(withoutWidows(text).replaceAll(NBSP, " ")).toBe(text);
  });
});
