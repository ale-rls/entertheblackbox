import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fontCss = readFileSync(new URL("fonts.css", import.meta.url), "utf8");

describe("local fonts", () => {
  it("uses only bundler-relative WOFF2 URLs", () => {
    expect(fontCss).not.toMatch(/https?:|\/\//i);
    const urls = [...fontCss.matchAll(/url\("([^"]+)"\)/g)].map(
      (match) => match[1]!,
    );
    expect(urls).toEqual([
      "./fonts/space-grotesk-latin-variable.woff2",
      "./fonts/ibm-plex-mono-latin-400.woff2",
      "./fonts/ibm-plex-mono-latin-500.woff2",
    ]);

    for (const url of urls) {
      const font = readFileSync(new URL(url, import.meta.url));
      expect(font.subarray(0, 4).toString("ascii"), url).toBe("wOF2");
    }
  });

  it("ships complete OFL notices for both families", () => {
    for (const license of ["SPACE_GROTESK_OFL.txt", "IBM_PLEX_MONO_OFL.txt"]) {
      const text = readFileSync(new URL(`../licenses/${license}`, import.meta.url), "utf8");
      expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
      expect(text).toContain("PERMISSION & CONDITIONS");
      expect(text).toContain("TERMINATION");
    }
  });

  it("records immutable, version-pinned provenance for the verified files", () => {
    const provenance = readFileSync(
      new URL("../licenses/FONT_SOURCES.md", import.meta.url),
      "utf8",
    );
    expect(provenance).not.toMatch(/@latest|\/main\//i);
    expect(provenance).toContain("space-grotesk:vf@5.2.10");
    expect(provenance).toContain("ibm-plex-mono@5.2.7");
    expect(provenance.match(/google\/fonts\/[0-9a-f]{40}\//g)).toHaveLength(2);

    const hashes = {
      "./fonts/space-grotesk-latin-variable.woff2":
        "0640890476fc1198ab4de571fb658de443c4d85b66466ec09534a8737ab1ce9d",
      "./fonts/ibm-plex-mono-latin-400.woff2":
        "08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7",
      "./fonts/ibm-plex-mono-latin-500.woff2":
        "01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22",
    };

    for (const [file, expectedHash] of Object.entries(hashes)) {
      const hash = createHash("sha256")
        .update(readFileSync(new URL(file, import.meta.url)))
        .digest("hex");
      expect(hash, file).toBe(expectedHash);
      expect(provenance).toContain(expectedHash);
    }
  });
});
