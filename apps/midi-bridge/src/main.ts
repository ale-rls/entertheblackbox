import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { EventSource } from "eventsource";
import { CueBridge } from "./bridge.js";
import { parseBridgeConfig } from "./config.js";
import { CueFeed, feedFetch, type FeedSource } from "./feed.js";
import { dryRunOutput, listOutputs, openOutput } from "./midi.js";

const usage = `MIDI bridge: show cue feed → MIDI (Ableton).

  pnpm midi-bridge --server https://show.example --config mapping.json
  pnpm midi-bridge --list-outputs
  pnpm midi-bridge --config mapping.json --test <cue or scene name>

Options:
  --server URL     show server (or SHOW_SERVER)
  --token TOKEN    display token (or DISPLAY_TOKEN); prefer the environment variable
  --config FILE    mapping file (default: midi-mapping.json); reloaded when saved
  --output NAME    MIDI output name to match (overrides the mapping file)
  --dry-run        print MIDI instead of sending it
  --list-outputs   list MIDI outputs and exit
  --test NAME      send one mapping entry (cue, scene or "showEnd") and exit`;

const log = (line: string) => console.log(`${new Date().toLocaleTimeString("de-DE")}  ${line}`);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      server: { type: "string" }, token: { type: "string" }, config: { type: "string" }, output: { type: "string" },
      "dry-run": { type: "boolean" }, "list-outputs": { type: "boolean" }, test: { type: "string" }, help: { type: "boolean" },
    },
  });
  if (values.help) { console.log(usage); return; }
  if (values["list-outputs"]) {
    const names = await listOutputs();
    console.log(names.length ? names.map((name) => `  ${name}`).join("\n") : "No MIDI outputs. Enable the IAC Driver in Audio MIDI Setup.");
    return;
  }

  // `pnpm midi-bridge` runs inside apps/midi-bridge; resolve paths from where it was typed.
  const configPath = resolve(process.env.INIT_CWD ?? process.cwd(), values.config ?? "midi-mapping.json");
  const loadConfig = () => parseBridgeConfig(readFileSync(configPath, "utf8"));
  const config = loadConfig();
  const outputName = values.output ?? config.output;
  const output = values["dry-run"] ? dryRunOutput(log) : await openOutput(outputName);
  const bridge = new CueBridge(config, output, log);
  log(`MIDI out: ${output.name} · mapping: ${configPath} (${Object.keys(config.cues).length} cues, ${Object.keys(config.scenes).length} scenes)`);

  if (values.test !== undefined) {
    if (!bridge.test(values.test)) throw new Error(`"${values.test}" is not a cue, scene or "showEnd" in the mapping file.`);
    // Let note offs go out before exiting.
    setTimeout(() => { output.close(); }, 1_000);
    return;
  }

  const server = values.server ?? process.env.SHOW_SERVER;
  const token = values.token ?? process.env.DISPLAY_TOKEN;
  if (!server || !token) throw new Error(`Missing --server/SHOW_SERVER or --token/DISPLAY_TOKEN.\n\n${usage}`);

  let reloadTimer: NodeJS.Timeout | undefined;
  watch(configPath, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      try { bridge.setConfig(loadConfig()); log("mapping reloaded"); }
      catch (error) { log(`mapping NOT reloaded, keeping the previous one: ${error instanceof Error ? error.message : String(error)}`); }
    }, 200);
  });

  // Same feed as the Eos bridge: it reopens after an HTTP error (a 502 while the server restarts, a 503 from
  // the proxy), which EventSource itself never does, and asks for an uncompressed stream the proxy passes on.
  const feed = new CueFeed(
    new URL("/api/cues", server),
    (url) => new EventSource(url, { fetch: feedFetch(token) }) as unknown as FeedSource,
    (data) => {
      try { bridge.handle(JSON.parse(data) as Parameters<CueBridge["handle"]>[0]); }
      catch (error) { log(`ignored a malformed event: ${error instanceof Error ? error.message : String(error)}`); }
    },
    log,
    () => { output.close(); process.exit(1); },
  );
  feed.start();
  const stop = () => { feed.stop(); output.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
