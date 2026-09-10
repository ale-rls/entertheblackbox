import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function runImporter(root: string, yaml: string): {
  status: number | null;
  output: string;
  destination: string;
} {
  const source = join(root, "show.yaml");
  const outDir = join(root, "out");
  const destination = join(outDir, "scenarios", "entertheblackbox.json");
  writeFileSync(source, yaml);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/import-show-yaml.ts", source, "--out-dir", outDir],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    destination,
  };
}

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "entertheblackbox-import-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const validQuestion = (id: string, duration = 45) => `  - id: ${id}
    type: majority
    form: scale
    duration_s: ${duration}
`;

describe("import-show-yaml atomic validation", () => {
  it("rejects missing narration duration without changing the prior output", () => {
    withTempRoot((root) => {
      const yaml = `rounds:
${"  - id: intro\n    type: narration\n    audio: missing.mp3\n"}`;
      const destination = join(root, "out", "scenarios", "entertheblackbox.json");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, "prior generated scenario\n");
      const prior = readFileSync(destination);

      const rerun = runImporter(root, yaml);
      expect(rerun.status).toBe(1);
      expect(rerun.output).toContain("fell back to a 60s placeholder");
      expect(readFileSync(destination)).toEqual(prior);
      expect(rerun.output).toContain("destination not changed");
    });
  });

  it("rejects an unmatched zone without changing the prior output", () => {
    withTempRoot((root) => {
      const yaml = `rounds:
${validQuestion("question")}    options:
      - zone: unexpected_zone
        label: Unexpected
`;
      const destination = join(root, "out", "scenarios", "entertheblackbox.json");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, "prior generated scenario\n");
      const prior = readFileSync(destination);

      const rerun = runImporter(root, yaml);
      expect(rerun.status).toBe(1);
      expect(rerun.output).toContain("unexpected_zone");
      expect(readFileSync(destination)).toEqual(prior);
    });
  });

  it("rejects schema-invalid candidates without creating or replacing output", () => {
    withTempRoot((root) => {
      const yaml = `rounds:
${validQuestion("invalid", 0)}`;
      const result = runImporter(root, yaml);
      expect(result.status).toBe(1);
      expect(result.output).toContain("scenario schema");
      expect(result.output).toContain("destination not changed");
      expect(() => readFileSync(result.destination)).toThrow();
    });
  });

  it("rejects graph-invalid candidates without changing the prior output", () => {
    withTempRoot((root) => {
      const yaml = `rounds:
${validQuestion("duplicate")}
${validQuestion("duplicate")}`;
      const destination = join(root, "out", "scenarios", "entertheblackbox.json");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, "prior generated scenario\n");
      const prior = readFileSync(destination);

      const result = runImporter(root, yaml);
      expect(result.status).toBe(1);
      expect(result.output).toContain("duplicate phase id");
      expect(readFileSync(destination)).toEqual(prior);
    });
  });

  it("atomically replaces the destination after successful validation", () => {
    withTempRoot((root) => {
      const yaml = `rounds:
${validQuestion("question", 10)}`;
      const destination = join(root, "out", "scenarios", "entertheblackbox.json");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, "prior generated scenario\n");

      const result = runImporter(root, yaml);
      expect(result.status).toBe(0);
      expect(result.output).toContain(`wrote ${destination}`);
      const generated = readFileSync(destination, "utf8");
      expect(generated).not.toBe("prior generated scenario\n");
      expect(JSON.parse(generated)).toMatchObject({ entryPhaseId: "question" });
    });
  });
});
