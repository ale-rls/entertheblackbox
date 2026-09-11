import type { StudioProject } from "@entertheblackbox/studio-adapter";

type Scenario = StudioProject["scenario"];
type Group = NonNullable<Scenario["groups"]>[number];
type Branch = Extract<Scenario["phases"][number], { kind: "group-branch" }>;

export function setGroupOptions(phase: Branch, groupIds: string[]): Branch {
  if (new Set(groupIds).size !== groupIds.length || groupIds.length < 2) throw new Error("Choose at least two different groups.");
  const assignment = phase.assignment;
  const fallback = (assignment.type === "manual" || assignment.type === "vote") && groupIds.includes(assignment.fallbackGroupId)
    ? assignment.fallbackGroupId : groupIds[0]!;
  return {
    ...phase,
    branches: groupIds.map((groupId) => phase.branches.find((branch) => branch.groupId === groupId) ?? { groupId, weight: 1 }),
    assignment: assignment.type === "manual" || assignment.type === "vote" ? {
      ...assignment,
      fallbackGroupId: groupIds.includes(assignment.fallbackGroupId) ? assignment.fallbackGroupId : fallback,
      ...(assignment.type === "vote" ? { map: Object.fromEntries(Object.entries(assignment.map).map(([outcome, id]) => [outcome, groupIds.includes(id) ? id : fallback])) } : {}),
    } : assignment,
  };
}

/** Catalogue changes must never leave dangling group references in a saved show. */
export function updateGroupCatalogue(scenario: Scenario, groups: Group[], initialGroupIds: string[]): Scenario {
  if (groups.length < 2) throw new Error("A show needs at least two groups.");
  const previous = scenario.groups ?? [];
  const ids = new Set(groups.map((group) => group.id));
  if (ids.size !== groups.length || groups.some((group) => !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(group.id))) throw new Error("Group IDs must be unique and use letters, numbers, hyphens or underscores.");
  const renamed = new Map<string, string>();
  if (previous.length === groups.length) previous.forEach((group, index) => {
    if (!ids.has(group.id)) renamed.set(group.id, groups[index]!.id);
  });
  const remap = (id: string) => renamed.get(id) ?? id;
  const phases = scenario.phases.map((phase) => {
    if (phase.kind === "idle") return phase;
    if (phase.kind !== "group-branch") return { ...phase, ...(phase.phoneAudioByGroup ? {
      phoneAudioByGroup: Object.fromEntries(Object.entries(phase.phoneAudioByGroup).filter(([id]) => ids.has(remap(id))).map(([id, src]) => [remap(id), src])),
    } : {}) };
    const branches = phase.branches.map((branch) => ({ ...branch, groupId: remap(branch.groupId) })).filter((branch) => ids.has(branch.groupId));
    if (branches.length < 2) throw new Error(`“${phase.title ?? phase.id}” would have fewer than two options. Add a replacement group to that scene first.`);
    const sourceGroupIds = phase.sourceGroupIds?.map(remap).filter((id) => ids.has(id));
    if (sourceGroupIds?.length === 0) throw new Error(`“${phase.title ?? phase.id}” uses this group as its only source.`);
    const assignment = phase.assignment;
    return setGroupOptions({ ...phase, branches, sourceGroupIds,
      assignment: assignment.type === "manual" || assignment.type === "vote" ? {
        ...assignment, fallbackGroupId: remap(assignment.fallbackGroupId),
        ...(assignment.type === "vote" ? { map: Object.fromEntries(Object.entries(assignment.map).map(([key, id]) => [key, remap(id)])) } : {}),
      } : assignment,
    }, branches.map((branch) => branch.groupId));
  });
  const initial = initialGroupIds.map(remap).filter((id) => ids.has(id));
  // Keep intermediate checkbox edits; validation prevents publishing a lone
  // initial group, but discarding it here makes selecting the second impossible.
  return { ...scenario, groups, phases: phases as Scenario["phases"], initialGroupIds: initial.length ? initial : undefined };
}
