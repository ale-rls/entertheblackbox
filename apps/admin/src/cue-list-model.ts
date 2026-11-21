import type { FlowScene, SceneFlow } from "./App.js";

/**
 * An operator's reading of the published routes: one cue list in playback
 * order, the points where the operator must act, and the alternatives they
 * can choose between. Derived from routes alone — no scenario fields.
 *
 * - A scene that routes to itself loops until the operator continues.
 * - Scenes nothing routes to are entered by hand. The longest such chain
 *   continues the show after a loop or dead end; chains that end the show
 *   are alternative endings; chains that rejoin are variants of the scene
 *   they replace.
 */
export type CueRow = {
  scene: FlowScene;
  /** Routes to itself: plays until the operator jumps on. */
  loops: boolean;
  /** Scenes that can be played instead of this one (they rejoin after it). */
  variants: CueRow[][];
  /** Tracks entered through a non-primary route (vote outcome, group path, empty group). */
  branches: Array<{ outcome: string; rows: CueRow[] }>;
};
export type CueItem =
  | { type: "scene"; row: CueRow }
  /** The previous scene loops or stops: the operator continues the show here. */
  | { type: "manual"; target: FlowScene; after: "loop" | "stop" };
export type CueEnding = { label: string; automatic: boolean; rows: CueRow[] };
export type CueList = {
  items: CueItem[];
  /** Alternative endings, chosen live by the operator. Null when the show has one ending. */
  endings: { afterSceneId: string | null; tracks: CueEnding[] } | null;
  /** Scenes the operator can reach but that fit nowhere above. */
  others: CueRow[][];
};

const QUESTION_KINDS = new Set<FlowScene["kind"]>(["position-question", "video-position-question"]);

/** The route playback follows when nothing intervenes. */
export function primaryTarget(scene: FlowScene): string | null {
  const route = scene.kind === "group-branch"
    ? scene.routes.find((item) => item.outcome === "rejoin")
    : scene.routes.find((item) => item.outcome === "next");
  if (route) return route.target;
  // Result-routed votes: the most common target stands in for "next".
  const counts = new Map<string, number>();
  for (const item of scene.routes) counts.set(item.target, (counts.get(item.target) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

type TrackEnd = { kind: "end" } | { kind: "loop" } | { kind: "stop" } | { kind: "joins"; sceneId: string };

export function buildCueList(flow: SceneFlow): CueList {
  const scenes = new Map(flow.scenes.map((scene) => [scene.id, scene]));
  const incoming = new Map<string, number>();
  for (const scene of flow.scenes) for (const route of scene.routes) {
    if (route.target !== scene.id) incoming.set(route.target, (incoming.get(route.target) ?? 0) + 1);
  }
  const claimed = new Map<string, CueRow>();

  /** Follows primary routes from `start` without claiming anything. */
  const reach = (start: string) => {
    const seen = new Set<string>();
    let id: string | null = start;
    while (id && scenes.has(id) && !claimed.has(id) && !seen.has(id)) { seen.add(id); id = primaryTarget(scenes.get(id)!); }
    return seen.size;
  };
  const track = (start: string): { rows: CueRow[]; end: TrackEnd } => {
    const rows: CueRow[] = [];
    let id: string | null = start;
    for (;;) {
      if (id === null || id === "idle") return { rows, end: { kind: "end" } };
      const scene = scenes.get(id);
      if (!scene) return { rows, end: { kind: "stop" } };
      if (claimed.has(id)) return { rows, end: { kind: "joins", sceneId: id } };
      const next = primaryTarget(scene);
      const row: CueRow = { scene, loops: next === id, variants: [], branches: [] };
      claimed.set(id, row); rows.push(row);
      if (row.loops) return { rows, end: { kind: "loop" } };
      id = next;
    }
  };
  const unclaimedRoots = () => flow.scenes
    .filter((scene) => !claimed.has(scene.id) && (incoming.get(scene.id) ?? 0) === 0)
    .sort((a, b) => reach(b.id) - reach(a.id));

  // Main line: the entry, continued by hand after each loop or dead end.
  const items: CueItem[] = [];
  let current = track(flow.entryPhaseId);
  items.push(...current.rows.map((row) => ({ type: "scene" as const, row })));
  while (current.end.kind === "loop" || current.end.kind === "stop") {
    const next = unclaimedRoots()[0];
    if (!next) break;
    const after = current.end.kind;
    current = track(next.id);
    items.push({ type: "manual", target: next, after }, ...current.rows.map((row) => ({ type: "scene" as const, row })));
  }

  // Secondary routes (vote outcomes, group paths, empty-group skips) open their own tracks.
  const expandBranches = (rows: CueRow[]) => {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const primary = primaryTarget(row.scene);
      for (const route of row.scene.routes) {
        if (route.target === primary || route.target === row.scene.id || claimed.has(route.target) || !scenes.has(route.target)) continue;
        const branch = track(route.target);
        row.branches.push({ outcome: route.outcome, rows: branch.rows });
        expandBranches(branch.rows);
      }
    }
  };
  const mainRows = () => items.flatMap((item) => item.type === "scene" ? [item.row] : []);
  expandBranches(mainRows());

  // Hand-entered chains: endings, variants, then anything left.
  const alternativeEndings: CueRow[][] = [];
  const others: CueRow[][] = [];
  const attachVariant = (rows: CueRow[], joins: string) => {
    const replaced = [...claimed.values()].find((row) => !rows.includes(row) && primaryTarget(row.scene) === joins);
    if (replaced) replaced.variants.push(rows); else others.push(rows);
  };
  for (let root = unclaimedRoots()[0]; root; root = unclaimedRoots()[0]) {
    const alternative = track(root.id);
    expandBranches(alternative.rows);
    if (alternative.end.kind === "end") alternativeEndings.push(alternative.rows);
    else if (alternative.end.kind === "joins") attachVariant(alternative.rows, alternative.end.sceneId);
    else others.push(alternative.rows);
  }
  // Cycles nothing enters from outside.
  for (const scene of flow.scenes) if (!claimed.has(scene.id)) { const rest = track(scene.id); expandBranches(rest.rows); others.push(rest.rows); }

  let endings: CueList["endings"] = null;
  if (alternativeEndings.length > 0) {
    const sceneIndexes = items.flatMap((item, index) => item.type === "scene" ? [index] : []);
    const lastQuestion = [...sceneIndexes].reverse().find((index) => QUESTION_KINDS.has((items[index] as { row: CueRow }).row.scene.kind));
    const longest = Math.max(...alternativeEndings.map((rows) => rows.length));
    const forkIndex = lastQuestion ?? sceneIndexes[Math.max(0, sceneIndexes.length - longest - 1)] ?? -1;
    const tail = items.splice(forkIndex + 1).flatMap((item) => item.type === "scene" ? [item.row] : []);
    const afterItem = items[forkIndex];
    endings = {
      afterSceneId: afterItem?.type === "scene" ? afterItem.row.scene.id : null,
      tracks: [tail, ...alternativeEndings].map((rows, index) => ({ label: String.fromCharCode(65 + index), automatic: index === 0, rows })),
    };
  }
  return { items, endings, others };
}

/** Every row in the list, including endings, variants, branches and others. */
export function allRows(list: CueList): CueRow[] {
  const out: CueRow[] = [];
  const visit = (rows: CueRow[]) => { for (const row of rows) { out.push(row); row.variants.forEach(visit); row.branches.forEach((branch) => visit(branch.rows)); } };
  visit(list.items.flatMap((item) => item.type === "scene" ? [item.row] : []));
  list.endings?.tracks.forEach((ending) => visit(ending.rows));
  list.others.forEach(visit);
  return out;
}

export type OperatorOption = { reason: string; scene: FlowScene };

/** What the operator can do from `currentId`: manual continuations, endings and variants that apply now. */
export function optionsAt(list: CueList, currentId: string): OperatorOption[] {
  const options: OperatorOption[] = [];
  const index = list.items.findIndex((item) => item.type === "scene" && item.row.scene.id === currentId);
  const following = index >= 0 ? list.items[index + 1] : undefined;
  if (following?.type === "manual") options.push({ reason: "Continue the show", scene: following.target });
  if (list.endings) {
    const tracks = list.endings.tracks;
    const atFork = list.endings.afterSceneId === currentId;
    const inEnding = tracks.find((ending) => ending.rows[0]?.scene.id === currentId);
    if (atFork || inEnding) for (const ending of tracks) {
      if (ending === inEnding || !ending.rows[0]) continue;
      options.push({ reason: `Ending ${ending.label}${ending.automatic ? " (automatic)" : ""}`, scene: ending.rows[0].scene });
    }
  }
  const byId = new Map(allRows(list).map((row) => [row.scene.id, row]));
  const here = byId.get(currentId);
  if (here) {
    const next = primaryTarget(here.scene);
    const upcoming = next !== null && next !== currentId ? byId.get(next) : undefined;
    for (const target of upcoming ? [here, upcoming] : [here]) {
      for (const variant of target.variants) if (variant[0]) options.push({ reason: `Instead of ${target.scene.cueName ?? target.scene.title}`, scene: variant[0].scene });
    }
    for (const branch of here.branches) if (branch.rows[0]) options.push({ reason: `Route “${branch.outcome}”`, scene: branch.rows[0].scene });
  }
  return options;
}

