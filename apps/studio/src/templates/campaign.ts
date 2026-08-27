import type { StudioProject } from "@smartphonecracy/studio-adapter";

type Phase = StudioProject["scenario"]["phases"][number];

const spectrumField = {
  type: "two-quadrant" as const,
  axis: "x" as const,
  labels: { minLabel: "überzeugt mich nicht", maxLabel: "überzeugt mich" },
};

function speech(id: string, src: string, candidateLabel: string, next: string): Phase {
  return {
    kind: "video-position-question",
    id,
    title: candidateLabel,
    src,
    expectedDurationMs: 180_000,
    text: `Wie überzeugend ist ${candidateLabel}?`,
    field: spectrumField,
    showAtMs: 0,
    openAtMs: 0,
    closeAtMs: 175_000,
    hideAtMs: 180_000,
    connectionStaleAfterMs: 10_000,
    showLiveCounts: false,
    showCursors: true,
    rating: { candidateLabel },
    next: { type: "fixed", target: next },
  };
}

const campaignPhases: Phase[] = [
  { kind: "video", id: "3-0-wahlkampf-auftakt", src: "3-0-wahlkampf-auftakt.mp4", expectedDurationMs: 60_000, next: "3-1-openapollo-rede" },
  speech("3-1-openapollo-rede", "3-1-openapollo-rede.mp4", "OpenApollo", "3-2-dionysos69-rede"),
  speech("3-2-dionysos69-rede", "3-2-dionysos69-rede.mp4", "Dionysos69", "3-3-kassandra-rede"),
  speech("3-3-kassandra-rede", "3-3-kassandra-rede.mp4", "Kassandra", "4-0-wahl-ansage"),
  { kind: "video", id: "4-0-wahl-ansage", src: "4-0-wahl-ansage.mp4", expectedDurationMs: 20_000, next: "4-0-wahl" },
  {
    kind: "position-question",
    id: "4-0-wahl",
    title: "Wahl der Zukunft",
    text: "Bewegt euer Licht zu der Statue, deren Zukunft ihr leben wollt.",
    field: {
      type: "polygon-zones",
      zones: [
        { id: "openapollo", label: "OpenApollo", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
        { id: "dionysos69", label: "Dionysos69", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
        { id: "kassandra", label: "Kassandra", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.7, y: 1 }] },
      ],
    },
    durationMs: 120_000,
    freezeMs: 10_000,
    connectionStaleAfterMs: 10_000,
    showLiveCounts: false,
    next: {
      type: "quadrant-plurality",
      map: {
        openapollo: "5-openapollo-auszaehlung",
        dionysos69: "5-dionysos69-auszaehlung",
        kassandra: "5-kassandra-auszaehlung",
      },
      tie: "4-0-wahl-unentschieden",
      tieBreak: { type: "kleroterion" },
      empty: "4-0-wahl-leer",
      countedStatuses: ["valid", "stale", "disconnected"],
    },
  },
  { kind: "video", id: "4-0-wahl-unentschieden", src: "4-0-wahl-unentschieden.mp4", expectedDurationMs: 20_000, next: "5-abschluss" },
  { kind: "video", id: "4-0-wahl-leer", src: "4-0-wahl-leer.mp4", expectedDurationMs: 20_000, next: "5-abschluss" },
  { kind: "video", id: "5-openapollo-auszaehlung", src: "5-auszaehlung.mp4", expectedDurationMs: 10_000, next: "5-openapollo-triumph" },
  { kind: "video", id: "5-openapollo-triumph", src: "5-openapollo-triumph.mp4", expectedDurationMs: 60_000, next: "5-openapollo-orakel" },
  { kind: "video", id: "5-openapollo-orakel", src: "5-openapollo-orakel.mp4", expectedDurationMs: 180_000, next: "5-abschluss" },
  { kind: "video", id: "5-dionysos69-auszaehlung", src: "5-auszaehlung.mp4", expectedDurationMs: 10_000, next: "5-dionysos69-triumph" },
  { kind: "video", id: "5-dionysos69-triumph", src: "5-dionysos69-triumph.mp4", expectedDurationMs: 60_000, next: "5-dionysos69-orakel" },
  { kind: "video", id: "5-dionysos69-orakel", src: "5-dionysos69-orakel.mp4", expectedDurationMs: 180_000, next: "5-abschluss" },
  { kind: "video", id: "5-kassandra-auszaehlung", src: "5-auszaehlung.mp4", expectedDurationMs: 10_000, next: "5-kassandra-triumph" },
  { kind: "video", id: "5-kassandra-triumph", src: "5-kassandra-triumph.mp4", expectedDurationMs: 60_000, next: "5-kassandra-orakel" },
  { kind: "video", id: "5-kassandra-orakel", src: "5-kassandra-orakel.mp4", expectedDurationMs: 180_000, next: "5-abschluss" },
  { kind: "video", id: "5-abschluss", src: "5-abschluss.mp4", expectedDurationMs: 10_000, next: "idle" },
];

export function appendCampaignExtension(project: StudioProject): StudioProject {
  const existingIds = new Set(project.scenario.phases.map((phase) => phase.id));
  const collision = campaignPhases.find((phase) => existingIds.has(phase.id));
  if (collision) throw new Error(`Campaign extension already exists or collides with phase “${collision.id}”.`);

  const preferred = project.scenario.phases.find((phase) => phase.id === "abmoderation");
  const fallback = [...project.scenario.phases].reverse().find((phase) => phase.kind === "video" && phase.next === "idle");
  const anchor = preferred ?? fallback;
  if (!anchor || anchor.kind !== "video" || anchor.next !== "idle") {
    throw new Error("The production ending could not be identified. Expected an abmoderation video, or a final video that points to idle.");
  }

  const phases = project.scenario.phases.map((phase) => phase.id === anchor.id
    ? { ...phase, next: "3-0-wahlkampf-auftakt" }
    : phase) as Phase[];
  const combined = [...phases, ...structuredClone(campaignPhases)];
  return {
    ...project,
    scenario: {
      ...project.scenario,
      phases: [combined[0]!, ...combined.slice(1)],
    },
  };
}
