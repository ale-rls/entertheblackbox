import { readFile } from "node:fs/promises";
import {
  mediaManifestSchema,
  scenarioSchema,
  statSizeWithNodeFs,
  validateMediaManifest,
  validateScenario,
  type MediaManifest,
  type Scenario,
} from "@smartphonecracy/scenario";
import type { ServerConfig } from "./config.js";
import type { PocketBaseClient } from "./persistence/pocketbase-client.js";

export type ScenarioReadiness =
  | { ready: true; scenario: Scenario; mediaManifest: MediaManifest; warnings: string[]; showId: string }
  | { ready: false; scenario: null; errors: string[]; warnings: string[] };

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Validate scenario + media manifest content already loaded from any source. */
async function validateScenarioContent(
  scenarioRaw: unknown,
  manifestRaw: unknown,
  loadErrors: string[],
  mediaDir: string,
  showId: string,
): Promise<ScenarioReadiness> {
  const errors = [...loadErrors];
  const warnings: string[] = [];

  const scenarioResult = scenarioSchema.safeParse(scenarioRaw);
  if (!scenarioResult.success) {
    errors.push(
      ...scenarioResult.error.issues.map(
        (issue) => `scenario ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  const manifestResult = mediaManifestSchema.safeParse(manifestRaw);
  if (!manifestResult.success) {
    errors.push(
      ...manifestResult.error.issues.map(
        (issue) => `media manifest ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }

  if (scenarioResult.success && manifestResult.success) {
    const graph = validateScenario(scenarioResult.data, manifestResult.data);
    errors.push(...graph.errors.map((issue) => issue.message));
    warnings.push(...graph.warnings.map((issue) => issue.message));

    const media = await validateMediaManifest(manifestResult.data, statSizeWithNodeFs(mediaDir));
    errors.push(...media.errors.map((issue) => issue.message));
  }

  if (errors.length > 0 || !scenarioResult.success || !manifestResult.success) {
    return { ready: false, scenario: null, errors, warnings };
  }
  return { ready: true, scenario: scenarioResult.data, mediaManifest: manifestResult.data, warnings, showId };
}

/** Validate all deployment content without preventing liveness endpoints from booting. */
export async function loadScenarioReadiness(
  config: Pick<ServerConfig, "scenarioPath" | "mediaManifestPath" | "mediaDir" | "showId">,
): Promise<ScenarioReadiness> {
  const errors: string[] = [];
  let scenarioRaw: unknown;
  let manifestRaw: unknown;
  try {
    scenarioRaw = await readJson(config.scenarioPath);
  } catch (error) {
    errors.push(`scenario: ${(error as Error).message}`);
  }
  try {
    manifestRaw = await readJson(config.mediaManifestPath);
  } catch (error) {
    errors.push(`media manifest: ${(error as Error).message}`);
  }
  return validateScenarioContent(scenarioRaw, manifestRaw, errors, config.mediaDir, config.showId);
}

type PublishedScenarioRecord = {
  showId: string;
  status: "draft" | "published";
  scenario: unknown;
  mediaManifest: unknown;
  publishedAt: number;
};

/**
 * Look up the currently published scenario in PocketBase. Media files
 * themselves still live on disk/externally (plan: "production media is
 * externally hosted"), so `mediaDir` is still needed to validate sizes.
 * Returns `null` when no scenario has been published yet, so callers can
 * fall back to the file-based loader.
 *
 * Every publish creates a new record rather than updating one (see
 * scripts/publish-scenario-to-pocketbase.ts), so without `activeShowId`
 * this picks whichever `status = "published"` record is newest,
 * regardless of showId -- the zero-config default before an operator has
 * ever chosen an active show via /api/admin/shows. Once one has been
 * chosen, only records for that showId are considered.
 */
export async function loadPublishedScenarioFromPocketbase(
  client: PocketBaseClient,
  mediaDir: string,
  activeShowId?: string,
): Promise<ScenarioReadiness | null> {
  await client.ensureAuth();
  const filter = activeShowId === undefined
    ? 'status = "published"'
    : client.pb.filter('status = "published" && showId = {:showId}', { showId: activeShowId });
  const published = await client.pb.collection<PublishedScenarioRecord>("scenarios").getFirstListItem(
    filter,
    { sort: "-publishedAt" },
  ).catch((error: unknown) => {
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 404) return null;
    throw error;
  });
  if (!published) return null;
  return validateScenarioContent(published.scenario, published.mediaManifest, [], mediaDir, published.showId);
}

export type PublishedShowSummary = {
  showId: string;
  name: string;
  version: string;
  publishedAt: number;
};

/**
 * Writes a new published scenarios record -- the HTTP write side Studio's
 * "Publish" action calls, so an operator never needs superuser PocketBase
 * credentials in the browser (scenarios' createRule is superuser-only,
 * same as scripts/publish-scenario-to-pocketbase.ts's CLI equivalent).
 * Deliberately does no scenario/media validation here, matching the CLI
 * script it replaces -- richer validation already happens when the server
 * next boots with this show selected (validateScenarioContent).
 */
export async function publishShow(
  client: PocketBaseClient,
  record: { showId: string; name: string; scenario: unknown; mediaManifest: unknown },
): Promise<PublishedShowSummary> {
  await client.ensureAuth();
  const version = (record.scenario as { version?: unknown } | null)?.version;
  const publishedAt = Date.now();
  await client.pb.collection("scenarios").create({
    showId: record.showId,
    name: record.name,
    version: typeof version === "string" ? version : "unknown",
    status: "published",
    scenario: record.scenario,
    mediaManifest: record.mediaManifest,
    publishedAt,
  });
  return { showId: record.showId, name: record.name, version: typeof version === "string" ? version : "unknown", publishedAt };
}

/**
 * Every publish's own showId, deduped to its most recent record (by
 * publishedAt) -- the option list for /api/admin/shows's picker.
 */
export async function listPublishedShows(client: PocketBaseClient): Promise<PublishedShowSummary[]> {
  await client.ensureAuth();
  const records = await client.pb.collection<PublishedScenarioRecord & { id: string; name?: string }>("scenarios")
    .getFullList({ filter: 'status = "published"', sort: "-publishedAt" });
  const byShowId = new Map<string, PublishedShowSummary>();
  for (const record of records) {
    if (byShowId.has(record.showId)) continue;
    const scenario = record.scenario as { version?: string } | null;
    byShowId.set(record.showId, {
      showId: record.showId,
      name: record.name?.trim() || record.showId,
      version: scenario?.version ?? "unknown",
      publishedAt: record.publishedAt,
    });
  }
  return [...byShowId.values()];
}
