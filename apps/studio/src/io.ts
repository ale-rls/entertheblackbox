import { compileStudioGraph, parseRuntimeScenario } from "@smartphonecracy/studio-adapter";
import { graphPhases, END_NODE_ID, ENTRY_NODE_ID } from "./canvas/graph.js";
import { autoLayout, type Draft, type StudioBackup, type StudioDocument } from "./model.js";

type UnknownRecord = Record<string, unknown>;

export type StudioImportFile = { name: string; value: unknown };
export type StudioImportResult = {
  draft: Draft;
  kind: "backup" | "runtime" | "package";
  message: string;
};

type ImportArtifact = "backup" | "scenario" | "manifest" | "studio" | "validation-report" | "readme";

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function artifactFromContent(value: unknown): ImportArtifact | undefined {
  if (typeof value === "string") return "readme";
  if (!isRecord(value)) return undefined;
  if (value.format === "smartphonecracy-studio-backup") return "backup";
  if ("studioFormatVersion" in value) return "studio";
  if (Array.isArray(value.phases) && "entryPhaseId" in value) return "scenario";
  if (Array.isArray(value.files)) return "manifest";
  if (value.valid === true && "runtimeSchemaVersion" in value && "diagnostics" in value) return "validation-report";
  return undefined;
}

function artifactFromName(name: string): ImportArtifact | undefined {
  const normalized = name.toLowerCase();
  if (normalized.endsWith(".studio-backup.json")) return "backup";
  if (normalized.endsWith("media-manifest.json")) return "manifest";
  if (normalized.endsWith("validation-report.json")) return "validation-report";
  if (normalized.endsWith(".studio.json")) return "studio";
  if (normalized.endsWith("scenario.json")) return "scenario";
  if (normalized.endsWith("readme.txt")) return "readme";
  return undefined;
}

function artifactPrefix(name: string, artifact: ImportArtifact): string | undefined {
  const normalized = name.toLowerCase();
  const suffix = {
    backup: ".studio-backup.json",
    manifest: "media-manifest.json",
    "validation-report": "validation-report.json",
    studio: ".studio.json",
    scenario: "scenario.json",
    readme: "readme.txt",
  }[artifact];
  return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : undefined;
}

function classifyImportFile(file: StudioImportFile): ImportArtifact {
  const fromName = artifactFromName(file.name);
  const fromContent = artifactFromContent(file.value);
  if (fromName && fromContent && fromName !== fromContent) {
    throw new Error(`${file.name} looks like ${fromName} by name but contains ${fromContent} data.`);
  }
  const artifact = fromContent ?? fromName;
  if (!artifact) throw new Error(`${file.name} is not a recognized Studio export artifact.`);
  return artifact;
}

function parseStudioDocument(raw: unknown, project: Draft["project"]): StudioDocument {
  if (!isRecord(raw) || raw.studioFormatVersion !== 1) {
    throw new Error("Unsupported or missing Studio document version.");
  }
  if (raw.canvasFormatVersion !== undefined && raw.canvasFormatVersion !== 1) {
    throw new Error("Unsupported Studio canvas version.");
  }
  if (raw.runtimeScenarioVersion !== project.scenario.version) {
    throw new Error(`Studio document targets scenario version ${String(raw.runtimeScenarioVersion)}, but scenario.json is ${project.scenario.version}.`);
  }
  if (typeof raw.showId !== "string" || !raw.showId.trim()) throw new Error("Studio document showId is missing.");
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !isRecord(raw.viewport)) {
    throw new Error("Studio document canvas data is incomplete.");
  }

  const nodes = raw.nodes.map((node, index) => {
    if (!isRecord(node) || typeof node.id !== "string" || !finiteNumber(node.x) || !finiteNumber(node.y)) {
      throw new Error(`Studio document node ${index + 1} is invalid.`);
    }
    return { id: node.id, x: node.x, y: node.y };
  });
  const expectedNodeIds = new Set([ENTRY_NODE_ID, ...graphPhases(project).map((phase) => phase.id), END_NODE_ID]);
  const actualNodeIds = new Set(nodes.map((node) => node.id));
  if (actualNodeIds.size !== nodes.length || actualNodeIds.size !== expectedNodeIds.size
    || [...expectedNodeIds].some((id) => !actualNodeIds.has(id))) {
    throw new Error("Studio document nodes do not match scenario.json.");
  }

  const edges = raw.edges.map((edge, index) => {
    if (!isRecord(edge) || typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string"
      || !expectedNodeIds.has(edge.source) || !expectedNodeIds.has(edge.target)
      || (edge.sourceHandle !== undefined && edge.sourceHandle !== null && typeof edge.sourceHandle !== "string")
      || (edge.targetHandle !== undefined && edge.targetHandle !== null && typeof edge.targetHandle !== "string")) {
      throw new Error(`Studio document edge ${index + 1} is invalid.`);
    }
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle as string | null } : {}),
      ...(edge.targetHandle !== undefined ? { targetHandle: edge.targetHandle as string | null } : {}),
    };
  });
  if (!finiteNumber(raw.viewport.x) || !finiteNumber(raw.viewport.y) || !finiteNumber(raw.viewport.zoom) || raw.viewport.zoom <= 0) {
    throw new Error("Studio document viewport is invalid.");
  }
  if (raw.notes !== undefined && (!isRecord(raw.notes) || Object.values(raw.notes).some((note) => typeof note !== "string"))) {
    throw new Error("Studio document notes are invalid.");
  }

  return {
    studioFormatVersion: 1,
    ...(raw.canvasFormatVersion === 1 ? { canvasFormatVersion: 1 as const } : {}),
    runtimeScenarioVersion: raw.runtimeScenarioVersion,
    showId: raw.showId,
    nodes,
    edges,
    viewport: { x: raw.viewport.x, y: raw.viewport.y, zoom: raw.viewport.zoom },
    ...(raw.notes ? { notes: raw.notes as Record<string, string> } : {}),
  };
}

export function importRuntime(scenario: unknown, manifest: unknown, name = "Imported show"): Draft {
  const project = parseRuntimeScenario(scenario, manifest);
  const id = crypto.randomUUID();
  return { id, name, updatedAt: Date.now(), project, document: autoLayout(project, id) };
}

export function importStudioPackage(
  scenario: unknown,
  manifest: unknown,
  studioDocument: unknown,
  name = "Imported show",
): Draft {
  const draft = importRuntime(scenario, manifest, name);
  return { ...draft, document: parseStudioDocument(studioDocument, draft.project) };
}

export function importBackup(raw: unknown): Draft {
  const backup = raw as Partial<StudioBackup>;
  if (backup.format !== "smartphonecracy-studio-backup" || backup.version !== 1 || !isRecord(backup.draft)) {
    throw new Error("Not a supported Studio backup");
  }
  const draft = backup.draft as unknown as Draft;
  if (typeof draft.id !== "string" || typeof draft.name !== "string" || !finiteNumber(draft.updatedAt) || !draft.project) {
    throw new Error("Studio backup draft metadata is invalid.");
  }
  compileStudioGraph(draft.project);
  const document = parseStudioDocument(draft.document, draft.project);
  return { ...structuredClone(draft), document };
}

export function importStudioFiles(files: readonly StudioImportFile[]): StudioImportResult {
  if (files.length === 0) throw new Error("No files were selected.");
  const artifacts = files.map((file) => {
    const artifact = classifyImportFile(file);
    return { ...file, artifact, prefix: artifactPrefix(file.name, artifact) };
  });
  const byKind = new Map<ImportArtifact, StudioImportFile[]>();
  for (const { artifact, name, value } of artifacts) {
    const matches = byKind.get(artifact) ?? [];
    matches.push({ name, value });
    byKind.set(artifact, matches);
  }
  for (const [artifact, matches] of byKind) {
    if (matches.length > 1) throw new Error(`Select only one ${artifact} artifact; received ${matches.map(({ name }) => name).join(", ")}.`);
  }
  const prefixes = new Set(artifacts.flatMap(({ prefix }) => prefix === undefined ? [] : [prefix]));
  if (prefixes.size > 1) throw new Error("Selected artifacts belong to different export packages.");

  const backup = byKind.get("backup")?.[0];
  if (backup) {
    if (files.length !== 1) throw new Error("A Studio backup must be imported by itself.");
    return { draft: importBackup(backup.value), kind: "backup", message: "Imported complete Studio backup." };
  }

  const scenario = byKind.get("scenario")?.[0];
  const manifest = byKind.get("manifest")?.[0];
  if (!scenario || !manifest) throw new Error("Select one scenario.json and one media-manifest.json.");
  const studio = byKind.get("studio")?.[0];

  if (studio) {
    return {
      draft: importStudioPackage(scenario.value, manifest.value, studio.value),
      kind: "package",
      message: "Imported complete Studio package with its saved canvas layout.",
    };
  }
  return {
    draft: importRuntime(scenario.value, manifest.value),
    kind: "runtime",
    message: "Imported runtime files and generated a new canvas layout.",
  };
}

export function exportArtifacts(draft: Draft) {
  const runtime = compileStudioGraph(draft.project);
  return {
    "scenario.json": runtime.scenario,
    "media-manifest.json": runtime.manifest,
    ".studio.json": draft.document,
  };
}

export function exportBackup(draft: Draft): StudioBackup {
  return { format: "smartphonecracy-studio-backup", version: 1, draft };
}
