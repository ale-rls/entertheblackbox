import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { END_NODE_ID, ENTRY_NODE_ID, graphEdges, graphPhases } from "./canvas/graph.js";

export type StudioNodeLayout = { id: string; x: number; y: number };
export type ProductionBaseline = {
  recordId: string;
  showId: string;
  name: string;
  version: string;
  publishedAt: number;
};
export type StudioDocument = {
  studioFormatVersion: 1;
  canvasFormatVersion?: 1;
  runtimeScenarioVersion: string;
  showId: string;
  nodes: StudioNodeLayout[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
  viewport: { x: number; y: number; zoom: number };
  notes?: Record<string, string>;
  /** Immutable production record this draft was forked from. Studio-only. */
  productionBaseline?: ProductionBaseline;
};

export type Draft = {
  id: string;
  name: string;
  updatedAt: number;
  /** Paths last discovered in content/media, used to prune deleted local files. */
  localMediaSources?: string[];
  project: StudioProject;
  document: StudioDocument;
};

export type StudioBackup = { format: "smartphonecracy-studio-backup"; version: 1; draft: Draft };

export function autoLayout(project: StudioProject, showId: string = crypto.randomUUID()): StudioDocument {
  const nodes = graphPhases(project).map((phase, index) => ({
    id: phase.id,
    x: 360 + (index % 3) * 300,
    y: 80 + Math.floor(index / 3) * 220,
  }));
  return {
    studioFormatVersion: 1,
    canvasFormatVersion: 1,
    runtimeScenarioVersion: project.scenario.version,
    showId,
    nodes: [
      { id: ENTRY_NODE_ID, x: 30, y: 80 },
      ...nodes,
      { id: END_NODE_ID, x: 1250, y: 500 },
    ],
    edges: graphEdges(project),
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
