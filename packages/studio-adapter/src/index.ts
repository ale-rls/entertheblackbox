import {
  mediaManifestSchema,
  normalizeScenarioInput,
  scenarioSchema,
  validateScenario,
  type MediaManifest,
  type Scenario,
  type ScenarioIssue,
} from "@entertheblackbox/scenario";

type UnknownRecord = Record<string, unknown>;

type KeyedArrayExtensions = {
  __studioKey: "id" | "src";
  __studioItems: Record<string, unknown>;
};

export type StudioProject = {
  scenario: Scenario;
  manifest: MediaManifest;
  /** Unknown runtime fields, retained separately so Studio data never leaks into exports. */
  runtimeExtensions: {
    scenario: UnknownRecord;
    manifest: UnknownRecord;
  };
};

export type StudioDiagnostic = {
  severity: "error" | "warning";
  code: "invalid-scenario" | "invalid-manifest" | ScenarioIssue["code"];
  message: string;
  phaseId?: string;
};

export class RuntimeImportError extends Error {
  constructor(
    readonly artifact: "scenario" | "manifest",
    readonly issues: readonly string[],
  ) {
    super(`Invalid runtime ${artifact}: ${issues.join("; ")}`);
    this.name = "RuntimeImportError";
  }
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const issueMessages = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  issues.map(({ path, message }) => `${path.length ? path.join(".") : "root"}: ${message}`);

/**
 * Keep only data stripped by the canonical schema. Known values always come from
 * the parsed model; unknown values round-trip through this sidecar.
 */
function arrayIdentity(items: unknown[]): "id" | "src" | undefined {
  for (const key of ["id", "src"] as const) {
    const values = items.map((item) => (isRecord(item) ? item[key] : undefined));
    if (
      values.length > 0 &&
      values.every((value): value is string => typeof value === "string") &&
      new Set(values).size === values.length
    ) {
      return key;
    }
  }
  return undefined;
}

function extensionsOf(raw: unknown, parsed: unknown): unknown {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    const identity = arrayIdentity(parsed);
    if (identity) {
      const rawByIdentity = new Map(
        raw.flatMap((item) =>
          isRecord(item) && typeof item[identity] === "string"
            ? [[item[identity], item] as const]
            : [],
        ),
      );
      const items = Object.fromEntries(
        parsed.flatMap((item) => {
          const key = (item as UnknownRecord)[identity] as string;
          const extensions = extensionsOf(rawByIdentity.get(key), item);
          return hasExtensions(extensions) ? [[key, extensions]] : [];
        }),
      );
      return Object.keys(items).length > 0
        ? ({ __studioKey: identity, __studioItems: items } satisfies KeyedArrayExtensions)
        : undefined;
    }
    const items = parsed.map((item, index) => extensionsOf(raw[index], item));
    return items.some(hasExtensions) ? items : undefined;
  }
  if (!isRecord(raw) || !isRecord(parsed)) return undefined;

  const extensions: UnknownRecord = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in parsed)) {
      extensions[key] = value;
      continue;
    }
    const nested = extensionsOf(value, parsed[key]);
    if (hasExtensions(nested)) extensions[key] = nested;
  }
  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

function hasExtensions(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExtensions);
  return isRecord(value) && Object.keys(value).length > 0;
}

function isKeyedArrayExtensions(value: unknown): value is KeyedArrayExtensions {
  return (
    isRecord(value) &&
    (value.__studioKey === "id" || value.__studioKey === "src") &&
    isRecord(value.__studioItems)
  );
}

function applyExtensions(known: unknown, extensions: unknown): unknown {
  if (Array.isArray(known)) {
    if (isKeyedArrayExtensions(extensions)) {
      return known.map((item) => {
        const identity = isRecord(item) ? item[extensions.__studioKey] : undefined;
        return applyExtensions(
          item,
          typeof identity === "string" ? extensions.__studioItems[identity] : undefined,
        );
      });
    }
    const extensionItems = Array.isArray(extensions) ? extensions : [];
    return known.map((item, index) => applyExtensions(item, extensionItems[index]));
  }
  if (!isRecord(known)) return known;

  const extensionRecord = isRecord(extensions) ? extensions : {};
  const result: UnknownRecord = { ...extensionRecord };
  for (const [key, value] of Object.entries(known)) {
    result[key] = applyExtensions(value, extensionRecord[key]);
  }
  return result;
}

export function parseRuntimeScenario(scenario: unknown, manifest: unknown): StudioProject {
  // Consume legacy top-level xAxis/yAxis question fields before capturing
  // unknown-field extensions, so migrated known fields never leak back into
  // canonical Studio exports through the raw-carry sidecar.
  const normalizedScenario = normalizeScenarioInput(scenario);
  const parsedScenario = scenarioSchema.safeParse(normalizedScenario);
  if (!parsedScenario.success) {
    throw new RuntimeImportError("scenario", issueMessages(parsedScenario.error.issues));
  }
  const parsedManifest = mediaManifestSchema.safeParse(manifest);
  if (!parsedManifest.success) {
    throw new RuntimeImportError("manifest", issueMessages(parsedManifest.error.issues));
  }

  return {
    scenario: parsedScenario.data,
    manifest: parsedManifest.data,
    runtimeExtensions: {
      scenario: (extensionsOf(normalizedScenario, parsedScenario.data) ?? {}) as UnknownRecord,
      manifest: (extensionsOf(manifest, parsedManifest.data) ?? {}) as UnknownRecord,
    },
  };
}

export function compileStudioGraph(project: StudioProject): {
  scenario: Scenario;
  manifest: MediaManifest;
} {
  const scenarioCandidate = applyExtensions(
    project.scenario,
    project.runtimeExtensions.scenario,
  );
  const manifestCandidate = applyExtensions(
    project.manifest,
    project.runtimeExtensions.manifest,
  );
  const parsedScenario = scenarioSchema.safeParse(scenarioCandidate);
  if (!parsedScenario.success) {
    throw new RuntimeImportError("scenario", issueMessages(parsedScenario.error.issues));
  }
  const parsedManifest = mediaManifestSchema.safeParse(manifestCandidate);
  if (!parsedManifest.success) {
    throw new RuntimeImportError("manifest", issueMessages(parsedManifest.error.issues));
  }

  // The canonical schemas deliberately strip unknown fields. Validate their
  // canonical view, but return the extension-bearing runtime artifacts.
  const validation = validateScenario(parsedScenario.data, parsedManifest.data);
  if (!validation.ok) {
    throw new RuntimeImportError(
      "scenario",
      validation.errors.map((issue) => issue.message),
    );
  }
  return {
    scenario: scenarioCandidate as Scenario,
    manifest: manifestCandidate as MediaManifest,
  };
}

export function validateStudioProject(project: StudioProject): StudioDiagnostic[] {
  try {
    const compiled = compileStudioGraph(project);
    const canonicalScenario = scenarioSchema.parse(compiled.scenario);
    const canonicalManifest = mediaManifestSchema.parse(compiled.manifest);
    const result = validateScenario(canonicalScenario, canonicalManifest);
    return [...result.errors, ...result.warnings].map((issue) => ({ ...issue }));
  } catch (error) {
    if (error instanceof RuntimeImportError) {
      return error.issues.map((message) => ({
        severity: "error",
        code: error.artifact === "scenario" ? "invalid-scenario" : "invalid-manifest",
        message,
      }));
    }
    throw error;
  }
}
