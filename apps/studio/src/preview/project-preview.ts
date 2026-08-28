import type { StudioProject } from "@smartphonecracy/studio-adapter";

const STORAGE_PREFIX = "smartphonecracy:studio-preview:";

export type ProjectPreview = {
  version: 1;
  draftName: string;
  project: StudioProject;
  startPhaseId: string;
  createdAt: number;
};

export function storeProjectPreview(draftName: string, project: StudioProject, startPhaseId: string): string {
  if (!project.scenario.phases.some((phase) => phase.id === startPhaseId)) {
    throw new Error(`Phase “${startPhaseId}” cannot be previewed because it is not in this show.`);
  }
  const token = crypto.randomUUID();
  const preview: ProjectPreview = { version: 1, draftName, project, startPhaseId, createdAt: Date.now() };
  localStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify(preview));
  return token;
}

export function readProjectPreview(token: string): ProjectPreview {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}${token}`);
  if (raw === null) throw new Error("This preview is no longer available. Return to Studio and open it again.");
  const value = JSON.parse(raw) as Partial<ProjectPreview>;
  if (
    value.version !== 1 ||
    typeof value.draftName !== "string" ||
    typeof value.startPhaseId !== "string" ||
    typeof value.createdAt !== "number" ||
    value.project?.scenario?.phases === undefined ||
    !value.project.scenario.phases.some((phase) => phase.id === value.startPhaseId)
  ) throw new Error("The stored preview data is invalid. Return to Studio and open it again.");
  return value as ProjectPreview;
}

export function projectPreviewUrl(token: string, baseUrl: string = document.baseURI): string {
  const url = new URL("preview.html", baseUrl);
  url.searchParams.set("preview", token);
  return url.href;
}
