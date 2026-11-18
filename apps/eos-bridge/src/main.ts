import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { EventSource } from "eventsource";
import { LightingBridge } from "./bridge.js";
import { parseBridgeConfig, type BridgeConfig } from "./config.js";
import { dryRunOutput, EosConnection, type LightOutput } from "./eos.js";
import { CueFeed, feedFetch, type FeedSource } from "./feed.js";
import { LookPlayer } from "./player.js";
import { watchFile } from "./watch.js";

const usage = `Eos bridge: show cue feed → lighting looks on the ETC Eos/Nomad desk (OSC over TCP).

  pnpm eos-bridge --server https://show.example --config lighting.json
  pnpm eos-bridge --config lighting.json --test <look, cue or scene>
  pnpm eos-bridge --config lighting.json --list
  pnpm eos-bridge --config lighting.json --ping

Options:
  --server URL   show server (or SHOW_SERVER)
  --token TOKEN  display token (or DISPLAY_TOKEN); prefer the environment variable
  --config FILE  lighting file (default: lighting.json); reloaded when saved
  --host IP      Eos desk address (overrides the lighting file)
  --dry-run      print looks instead of sending them
  --test NAME    play a look (or the look a cue/scene points at), wait for its fade, exit.
                 Repeat it to play several in order: the first snaps, the rest fade from the one before
  --list         list fixtures, palette, looks and triggers, then exit
  --ping         check the desk answers, then exit`;

const log = (line: string) => console.log(`${new Date().toLocaleTimeString("de-DE")}  ${line}`);

const setupOf = (config: BridgeConfig) =>
  Object.values(config.fixtures).filter((fixture) => fixture.setup && Object.keys(fixture.setup).length).map((fixture) => ({ channel: fixture.channel, params: fixture.setup! }));

function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((done) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (condition()) { clearInterval(timer); done(true); } else if (Date.now() - started > timeoutMs) { clearInterval(timer); done(false); }
    }, 50);
  });
}

function list(config: BridgeConfig): void {
  const section = (title: string, rows: string[]) => console.log(`${title}\n${rows.length ? rows.map((row) => `  ${row}`).join("\n") : "  (none)"}\n`);
  section("Fixtures", Object.entries(config.fixtures).map(([name, fixture]) => `${name} = Eos channel ${fixture.channel}${fixture.setup ? ` · setup ${JSON.stringify(fixture.setup)}` : ""}`));
  section("Palette", Object.entries(config.palette).map(([name, color]) => `${name}: ${typeof color === "string" ? color : JSON.stringify(color)}`));
  section("Looks", Object.entries(config.looks).map(([name, look]) => `${name}${look.fade ? ` (${look.fade} s)` : ""}: ${Object.entries(look.fixtures).map(([fixture, state]) => `${fixture} ${[state.color, state.level !== undefined ? `${state.level}%` : undefined].filter(Boolean).join(" ")}`).join(" · ")}`));
  section("Triggers", [
    ...Object.entries(config.cues).map(([cue, look]) => `cue "${cue}" → ${look}`),
    ...Object.entries(config.scenes).flatMap(([scene, trigger]) => typeof trigger === "string" ? [`scene ${scene} → ${trigger}`]
      : trigger.map((step) => `scene ${scene} at ${step.at} s → ${step.look}`)),
    ...Object.entries(config.results).flatMap(([scene, winners]) => Object.entries(winners).map(([winner, look]) => `vote ${scene} → ${winner} → ${look}`)),
    ...(config.showEnd ? [`show end → ${config.showEnd}`] : []),
  ]);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      server: { type: "string" }, token: { type: "string" }, config: { type: "string" }, host: { type: "string" },
      "dry-run": { type: "boolean" }, test: { type: "string", multiple: true }, list: { type: "boolean" }, ping: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  if (values.help) { console.log(usage); return; }

  // `pnpm eos-bridge` runs inside apps/eos-bridge; resolve paths from where it was typed.
  const configPath = resolve(process.env.INIT_CWD ?? process.cwd(), values.config ?? "lighting.json");
  const loadConfig = () => parseBridgeConfig(readFileSync(configPath, "utf8"));
  const config = loadConfig();
  if (values.list) { list(config); return; }

  const targetOf = (c: BridgeConfig) => ({ host: values.host ?? c.eos.host, port: c.eos.port, user: c.eos.user });
  const target = targetOf(config);
  let output: LightOutput;
  let eos: EosConnection | null = null;
  // Created below; the connection only reports changes after it has connected.
  let player: LookPlayer | null = null;
  if (values["dry-run"]) {
    output = dryRunOutput(log);
  } else {
    eos = new EosConnection(target, log, {
      setup: setupOf(config),
      onConnectionChange: (up) => {
        if (!player) return;
        // Messages written just before a drop may never have arrived: stop trusting what the desk shows.
        if (!up) { player.forget(); log("desk connection lost · the current look is sent again on reconnect"); return; }
        const channels = player.resync();
        if (channels) log(`current look sent again (${channels} channel${channels === 1 ? "" : "s"})`);
      },
      onCaughtUp: () => { player?.resync(); },
    });
    eos.connect();
    output = eos;
  }
  player = new LookPlayer(output);
  // Colour swatches per lamp on each look's log line, only where a terminal shows them (not in a log file).
  const showSwatches = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const bridge = new LightingBridge(config, player, log, undefined, undefined, showSwatches);
  log(`lights: ${output.name} · lighting file: ${configPath} (${Object.keys(config.fixtures).length} fixtures, ${Object.keys(config.palette).length} colours, ${Object.keys(config.looks).length} looks)`);

  if (values.ping || values.test !== undefined) {
    if (eos && !(await waitFor(() => eos!.isConnected, 5_000))) throw new Error(`Cannot reach the desk at ${target.host}:${target.port}. Is Nomad running, and is the address (eos.host, --host or EOS_HOST) right?`);
    if (values.ping) {
      const ok = eos ? await eos.ping() : true;
      log(ok ? "desk answered" : "connected, but the desk did not answer the ping");
      output.close();
      process.exit(ok ? 0 : 1);
    }
    const names = values.test!;
    for (const [index, name] of names.entries()) {
      if (!bridge.test(name)) throw new Error(`"${name}" is not a look, cue, scene or "showEnd" in the lighting file.`);
      await waitFor(() => !player!.fading, 10 * 60_000);
      // Hold each look a moment so it can be seen before the next one fades in.
      if (index < names.length - 1) await new Promise((done) => setTimeout(done, 2_000));
    }
    // Let the last OSC messages leave the socket before exiting.
    setTimeout(() => { output.close(); process.exit(0); }, 500);
    return;
  }

  const server = values.server ?? process.env.SHOW_SERVER;
  const token = values.token ?? process.env.DISPLAY_TOKEN;
  if (!server || !token) throw new Error(`Missing --server/SHOW_SERVER or --token/DISPLAY_TOKEN.\n\n${usage}`);

  const stopWatching = watchFile(configPath, () => {
    let next: BridgeConfig;
    try { next = loadConfig(); } catch (error) {
      log(`lighting file NOT reloaded, keeping the previous one: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    bridge.setConfig(next);
    // A new address, port or user means another desk (or the same one after a replug): reconnect there
    // before sending the new fixture setup, so the old desk never receives it.
    if (eos && eos.configure(targetOf(next), setupOf(next))) player!.forget();
    log(`lighting file reloaded${values.host && next.eos.host !== values.host ? ` (eos.host ignored: --host ${values.host} wins)` : ""}`);
  });

  const feed = new CueFeed(
    new URL("/api/cues", server),
    (url) => new EventSource(url, { fetch: feedFetch(token) }) as unknown as FeedSource,
    (data) => {
      try { bridge.handle(JSON.parse(data) as Parameters<LightingBridge["handle"]>[0]); }
      catch (error) { log(`ignored a malformed event: ${error instanceof Error ? error.message : String(error)}`); }
    },
    log,
    () => { stopWatching(); output.close(); process.exit(1); },
  );
  feed.start();
  const stop = () => { feed.stop(); stopWatching(); output.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
