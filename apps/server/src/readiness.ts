import { readFile } from "node:fs/promises";
import {
  mediaManifestSchema,
  scenarioSchema,
  statSizeWithNodeFs,
  validateMediaManifest,
  validateScenario,
  type Scenario,
} from "@smartphonecracy/scenario";
import type { ServerConfig } from "./config.js";
import type { PocketBaseClient } from "./persistence/pocketbase-client.js";

export type ScenarioReadiness =
  | { ready: true; scenario: Scenario; warnings: string[]; showId: string }
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

  if (errors.length > 0 || !scenarioResult.success) {
    return { ready: false, scenario: null, errors, warnings };
  }
  return { ready: true, scenario: scenarioResult.data, warnings, showId };
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
 */
export async function loadPublishedScenarioFromPocketbase(
  client: PocketBaseClient,
  mediaDir: string,
): Promise<ScenarioReadiness | null> {
  await client.ensureAuth();
  const published = await client.pb.collection<PublishedScenarioRecord>("scenarios").getFirstListItem(
    'status = "published"',
    { sort: "-publishedAt" },
  ).catch((error: unknown) => {
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 404) return null;
    throw error;
  });
  if (!published) return null;
  return validateScenarioContent(published.scenario, published.mediaManifest, [], mediaDir, published.showId);
}
