// Builds a portable Eos bridge for the Windows PC that runs Eos/Nomad: no Node, pnpm or repo needed there.
//
//   pnpm eos-bridge:windows [--lighting path/to/lighting.json] [--out folder]
//
// The folder holds the official node.exe (checksum-checked), the bridge bundled into one file and
// double-click launchers. Copy it to the PC (USB stick) and start "Start Eos bridge.cmd".
// See docs/eos-lighting.md, "Running on the Nomad PC".
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

/** Node for Windows shipped in the folder. Bump both together; the hash is from nodejs.org's SHASUMS256.txt. */
const NODE_VERSION = "22.23.5";
const NODE_ZIP_SHA256 = "4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");
const cwd = process.env.INIT_CWD ?? process.cwd();
const { values } = parseArgs({ options: { lighting: { type: "string" }, out: { type: "string" } } });
const outDir = resolve(cwd, values.out ?? join(repoRoot, "dist/eos-bridge-windows"));
const lightingPath = values.lighting ? resolve(cwd, values.lighting) : join(repoRoot, "lighting.json");
if (values.lighting && !existsSync(lightingPath)) throw new Error(`No lighting file at ${lightingPath}`);

// Rebuild from scratch, but never delete a settings file someone filled in there (it holds the token).
if (existsSync(join(outDir, "settings.cmd"))) throw new Error(`${outDir} holds settings.cmd (maybe a real token). Move it away or pick another --out.`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "node"), { recursive: true });

// 1. The bridge in one file.
await build({
  entryPoints: [join(appDir, "src/main.ts")],
  outfile: join(outDir, "eos-bridge.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Bundled CommonJS dependencies may call require() for Node built-ins.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: "warning",
});

// 2. node.exe from nodejs.org, checked against the pinned hash.
const zipName = `node-v${NODE_VERSION}-win-x64.zip`;
const cacheDir = join(repoRoot, "node_modules/.cache/eos-bridge-windows");
const zipPath = join(cacheDir, zipName);
if (!existsSync(zipPath)) {
  mkdirSync(cacheDir, { recursive: true });
  console.log(`downloading ${zipName} …`);
  const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
}
const hash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
if (hash !== NODE_ZIP_SHA256) {
  rmSync(zipPath);
  throw new Error(`${zipName} has the wrong checksum (${hash}); deleted it. Run again to download it afresh.`);
}
const unpacked = mkdtempSync(join(tmpdir(), "eos-bridge-node-"));
try {
  // bsdtar (macOS, Windows 10+) reads zip files; GNU tar does not, so fall back to unzip there.
  try { execFileSync("tar", ["-xf", zipPath, "-C", unpacked], { stdio: "pipe" }); }
  catch { execFileSync("unzip", ["-q", zipPath, "-d", unpacked]); }
  const nodeDir = join(unpacked, `node-v${NODE_VERSION}-win-x64`);
  copyFileSync(join(nodeDir, "node.exe"), join(outDir, "node/node.exe"));
  copyFileSync(join(nodeDir, "LICENSE"), join(outDir, "node/LICENSE"));
} finally {
  rmSync(unpacked, { recursive: true, force: true });
}

// 3. Lighting file and launchers. Batch files need CRLF line endings.
copyFileSync(join(appDir, "lighting.example.json"), join(outDir, "lighting.example.json"));
if (existsSync(lightingPath)) copyFileSync(lightingPath, join(outDir, "lighting.json"));
const cmd = (name, lines) => writeFileSync(join(outDir, name), `${lines.join("\r\n")}\r\n`);

/** Every launcher starts the same way: its own folder, UTF-8 console, settings and lighting file in place. */
const prelude = [
  "@echo off",
  'cd /d "%~dp0"',
  "chcp 65001 >nul",
  "if not exist settings.cmd copy settings.example.cmd settings.cmd >nul",
  "if not exist lighting.json copy lighting.example.json lighting.json >nul",
  "set EOS_HOST=",
  "call settings.cmd",
  'set HOST_ARG=',
  'if not "%EOS_HOST%"=="" set HOST_ARG=--host %EOS_HOST%',
];
const run = "node\\node.exe eos-bridge.mjs --config lighting.json %HOST_ARG%";

cmd("settings.example.cmd", [
  "@rem Settings for the Eos bridge on this PC. This file (settings.cmd) holds a secret: keep it on this PC, never in git or chat.",
  "@rem The show server's address:",
  "set SHOW_SERVER=https://",
  "@rem The display token (the same secret the main display uses):",
  "set DISPLAY_TOKEN=",
  "@rem The desk. 127.0.0.1 is Eos/Nomad on this same PC; it overrides eos.host in lighting.json. Leave empty to use lighting.json.",
  "set EOS_HOST=127.0.0.1",
]);
cmd("Start Eos bridge.cmd", [
  ...prelude,
  "title Eos bridge",
  'if "%DISPLAY_TOKEN%"=="" (',
  "  echo Fill in the show server and display token in settings.cmd, save it, and start again.",
  "  start notepad settings.cmd",
  "  pause",
  "  exit /b 1",
  ")",
  run,
  "echo.",
  "echo The Eos bridge has stopped (see above). Press a key to close this window.",
  "pause >nul",
]);
cmd("Ping desk.cmd", [...prelude, "title Eos bridge: ping", `${run} --ping`, "pause"]);
cmd("List looks.cmd", [...prelude, "title Eos bridge: looks", `${run} --list`, "pause"]);
cmd("Test look.cmd", [
  ...prelude,
  "title Eos bridge: test",
  ":again",
  "set NAME=",
  'set /p NAME=Look, cue or scene to play (empty to quit): ',
  'if "%NAME%"=="" exit /b 0',
  `${run} --test "%NAME%"`,
  "goto again",
]);
cmd("README.txt", [
  "Eos bridge for the Nomad PC",
  "===========================",
  "",
  "Nothing to install. Keep this folder together (e.g. on the Desktop).",
  "",
  "1. Start Eos/Nomad.",
  "2. Double-click 'Ping desk.cmd'. It should say 'desk answered'.",
  "3. Double-click 'Start Eos bridge.cmd'. The first time it opens settings.cmd in Notepad:",
  "   fill in SHOW_SERVER and DISPLAY_TOKEN, save, and start it again.",
  "4. Leave the bridge window open during the show. Close it to stop the bridge.",
  "",
  "lighting.json holds the looks. Edit and save it while the bridge runs: it reloads by itself.",
  "'List looks.cmd' shows what is in it; 'Test look.cmd' plays a look on the desk.",
  "",
  "When updating this folder from a new build, keep your settings.cmd (and lighting.json if you edited it here).",
  "",
  `Node.js ${NODE_VERSION} (node\\node.exe) is from nodejs.org; its licence is in node\\LICENSE.`,
  "Full guide: docs/eos-lighting.md in the repository.",
]);

// 4. A zip to copy to the PC, if this machine can make one.
const zipOut = `${outDir}.zip`;
rmSync(zipOut, { force: true });
try {
  if (process.platform === "win32") execFileSync("tar", ["-a", "-cf", zipOut, "-C", dirname(outDir), "eos-bridge-windows"]);
  else execFileSync("zip", ["-rqX", zipOut, "."], { cwd: outDir });
  console.log(`Eos bridge for Windows: ${zipOut}\n(unpacked: ${outDir})`);
} catch {
  console.log(`Eos bridge for Windows: ${outDir}\n(no zip tool found; copy the folder)`);
}
console.log(existsSync(join(outDir, "lighting.json"))
  ? `lighting.json included from ${lightingPath}`
  : "No lighting.json included: the PC starts from lighting.example.json (pass --lighting FILE to include one).");
