import { describe, expect, it } from "vitest";
import {
  arenaQuadSchema,
  mediaManifestSchema,
  polygonZonesFieldSchema,
  scenarioSchema,
  validateMediaManifest,
  validateScenario,
} from "./index.js";
import type { MediaManifest, Scenario } from "./index.js";

const question = (id: string, next: Scenario["phases"][number]) => ({
  kind: "position-question" as const,
  id,
  text: "Where do you stand?",
  field: {
    type: "four-quadrant" as const,
    xAxis: { minLabel: "left", maxLabel: "right" },
    yAxis: { minLabel: "up", maxLabel: "down" },
  },
  durationMs: 60_000,
  freezeMs: 3_000,
  connectionStaleAfterMs: 30_000,
  showLiveCounts: false,
  next: { type: "fixed" as const, target: next.id },
});

const idle = { kind: "idle" as const, id: "idle" as const };

const baseScenario = {
  version: "test-1",
  entryPhaseId: "intro",
  cyclesAllowed: false,
  phases: [
    idle,
    {
      kind: "video" as const,
      id: "intro",
      src: "intro.mp4",
      expectedDurationMs: 10_000,
      next: "q1",
    },
    {
      kind: "position-question" as const,
      id: "q1",
      text: "Choose",
      field: {
        type: "four-quadrant" as const,
        xAxis: { minLabel: "a", maxLabel: "b" },
        yAxis: { minLabel: "c", maxLabel: "d" },
      },
      durationMs: 60_000,
      freezeMs: 3_000,
      connectionStaleAfterMs: 30_000,
      showLiveCounts: true,
      next: {
        type: "quadrant-plurality" as const,
        map: { q1: "idle", q2: "idle", q3: "idle", q4: "idle" },
        tie: "idle",
        empty: "idle",
        countedStatuses: ["valid" as const, "stale" as const, "disconnected" as const],
      },
    },
  ],
} satisfies Scenario;

const parse = (mutate: (s: typeof baseScenario) => unknown) =>
  scenarioSchema.safeParse(mutate(structuredClone(baseScenario)));

describe("scenarioSchema structural rejection", () => {
  it("accepts the base scenario", () => {
    expect(scenarioSchema.safeParse(baseScenario).success).toBe(true);
  });

  it("accepts visual tails for video and image + MP3 while rejecting incomplete combinations", () => {
    const imageAudio = structuredClone(baseScenario);
    imageAudio.phases[1] = {
      ...imageAudio.phases[1]!,
      src: "portrait.png",
      audioSrc: "introduction.mp3",
      tailDurationMs: 2_000,
      expectedDurationMs: 27_000,
    } as typeof imageAudio.phases[1];
    expect(scenarioSchema.safeParse(imageAudio).success).toBe(true);
    expect(validateScenario(scenarioSchema.parse(imageAudio), { files: [
      { src: "portrait.png", bytes: 10, hash: "image" },
      { src: "introduction.mp3", bytes: 20, hash: "audio" },
    ] }).ok).toBe(true);

    expect(scenarioSchema.safeParse({
      ...imageAudio,
      phases: imageAudio.phases.map((phase) => phase.id === "intro" ? { ...phase, audioSrc: undefined } : phase),
    }).success).toBe(false);
    const missingAudio = validateScenario(scenarioSchema.parse(imageAudio), { files: [
      { src: "portrait.png", bytes: 10, hash: "image" },
    ] });
    expect(missingAudio.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-media", message: expect.stringContaining("introduction.mp3") })]));

    const heldVideo = scenarioSchema.safeParse({
      ...baseScenario,
      phases: baseScenario.phases.map((phase) => phase.id === "intro" ? { ...phase, tailDurationMs: 1_000 } : phase),
    });
    expect(heldVideo.success).toBe(true);
  });

  it("accepts optional targetAudienceSize and per-phase display effects", () => {
    const result = parse((s) => ({
      ...s,
      targetAudienceSize: 30,
      phases: s.phases.map((phase) => phase.kind === "idle"
        ? phase
        : phase.kind === "position-question"
          ? { ...phase, showCursors: false, spectrumGlow: false }
          : { ...phase, showCursors: false }),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetAudienceSize).toBe(30);
      expect(result.data.phases.find((p) => p.id === "intro")).toMatchObject({ showCursors: false });
      expect(result.data.phases.find((p) => p.id === "q1")).toMatchObject({ spectrumGlow: false });
    }
  });

  it("accepts a curated random tie pool and rejects invalid outcome selections", () => {
    const withCandidates = (candidates: string[]) => parse((s) => ({
      ...s,
      phases: s.phases.map((phase) => phase.id === "q1" && phase.kind === "position-question"
        ? { ...phase, next: { ...phase.next, tieBreak: { type: "kleroterion", candidates } } }
        : phase),
    }));

    expect(withCandidates(["q1", "q3"]).success).toBe(true);
    expect(withCandidates(["q1"]).success).toBe(false);
    expect(withCandidates(["q1", "q1"]).success).toBe(false);
    expect(withCandidates(["q1", "not-an-outcome"]).success).toBe(false);
  });

  it("accepts optional display titles and rejects empty titles", () => {
    const titled = parse((s) => ({
      ...s,
      phases: s.phases.map((phase) => phase.kind === "idle" ? phase : { ...phase, title: `Title for ${phase.id}` }),
    }));
    expect(titled.success).toBe(true);
    const empty = parse((s) => ({
      ...s,
      phases: s.phases.map((phase) => phase.id === "intro" ? { ...phase, title: "" } : phase),
    }));
    expect(empty.success).toBe(false);
  });

  it("accepts a timed video position vote and enforces its timeline order", () => {
    const composite = {
      version: "video-vote-1",
      entryPhaseId: "video-vote",
      cyclesAllowed: false,
      phases: [
        idle,
        {
          kind: "video-position-question",
          id: "video-vote",
          src: "question.mp4",
          expectedDurationMs: 45_000,
          text: "Where do you stand?",
          field: {
            type: "four-quadrant",
            xAxis: { minLabel: "Left", maxLabel: "Right" },
            yAxis: { minLabel: "Top", maxLabel: "Bottom" },
          },
          showAtMs: 15_000,
          openAtMs: 15_000,
          closeAtMs: 35_000,
          hideAtMs: 40_000,
          connectionStaleAfterMs: 10_000,
          showLiveCounts: true,
          rating: { candidateLabel: "OpenApollo" },
          next: { type: "fixed", target: "idle" },
        },
      ],
    };
    expect(scenarioSchema.safeParse(composite).success).toBe(true);
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], { ...composite.phases[1], src: "question.png", audioSrc: "question.mp3" }],
    }).success).toBe(true);
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], { ...composite.phases[1], closeAtMs: 14_000 }],
    }).success).toBe(false);

    const ellipse = {
      type: "ellipse" as const,
      centerX: 0.5,
      centerY: 0.7,
      radiusX: 0.4,
      radiusY: 0.2,
    };
    const compositeVote = composite.phases[1] as (typeof composite.phases)[number] & { field: Record<string, unknown> };
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], {
        ...compositeVote,
        field: { ...compositeVote.field, arena: ellipse },
      }],
    }).success).toBe(true);
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], {
        ...compositeVote,
        field: { ...compositeVote.field, arena: { ...ellipse, splitY: 0.55 } },
      }],
    }).success).toBe(true);
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], {
        ...compositeVote,
        field: { ...compositeVote.field, arena: { ...ellipse, splitY: 0.95 } },
      }],
    }).success).toBe(false);
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], {
        ...compositeVote,
        field: { ...compositeVote.field, arena: { ...ellipse, radiusY: 0.4 } },
      }],
    }).success).toBe(false);

    const quad = {
      type: "quad" as const,
      corners: [
        { x: 0.14, y: 0.52 },
        { x: 0.86, y: 0.52 },
        { x: 0.94, y: 0.97 },
        { x: 0.06, y: 0.97 },
      ],
    };
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], {
        ...compositeVote,
        field: { ...compositeVote.field, arena: quad },
      }],
    }).success).toBe(true);
    expect(scenarioSchema.safeParse({
      ...composite,
      phases: [composite.phases[0], {
        ...compositeVote,
        // A quad collapsed onto a single point has no visible area.
        field: { ...compositeVote.field, arena: { type: "quad", corners: [quad.corners[0], quad.corners[0], quad.corners[0], quad.corners[0]] } },
      }],
    }).success).toBe(false);
  });

  it("validates an arena quad's corners", () => {
    expect(arenaQuadSchema.safeParse({
      type: "quad",
      corners: [{ x: 0.14, y: 0.52 }, { x: 0.86, y: 0.52 }, { x: 0.94, y: 0.97 }, { x: 0.06, y: 0.97 }],
    }).success).toBe(true);
    // Out-of-range coordinate.
    expect(arenaQuadSchema.safeParse({
      type: "quad",
      corners: [{ x: -0.1, y: 0.52 }, { x: 0.86, y: 0.52 }, { x: 0.94, y: 0.97 }, { x: 0.06, y: 0.97 }],
    }).success).toBe(false);
    // Only 3 corners.
    expect(arenaQuadSchema.safeParse({
      type: "quad",
      corners: [{ x: 0.14, y: 0.52 }, { x: 0.86, y: 0.52 }, { x: 0.94, y: 0.97 }],
    }).success).toBe(false);
    // Degenerate (zero-area) quad.
    expect(arenaQuadSchema.safeParse({
      type: "quad",
      corners: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
    }).success).toBe(false);
  });

  it("canonicalizes legacy xAxis/yAxis questions to four quadrants", () => {
    const legacy = structuredClone(baseScenario) as unknown as Record<string, unknown>;
    const phases = legacy.phases as Array<Record<string, unknown>>;
    const phase = phases[2]!;
    const field = phase.field as { xAxis: unknown; yAxis: unknown };
    delete phase.field;
    phase.xAxis = field.xAxis;
    phase.yAxis = field.yAxis;

    const parsed = scenarioSchema.parse(legacy);
    const question = parsed.phases[2];
    expect(question?.kind).toBe("position-question");
    if (question?.kind === "position-question") {
      expect(question.field).toEqual({
        type: "four-quadrant",
        xAxis: { minLabel: "a", maxLabel: "b" },
        yAxis: { minLabel: "c", maxLabel: "d" },
      });
      expect(question).not.toHaveProperty("xAxis");
      expect(question).not.toHaveProperty("yAxis");
    }
  });

  it("accepts correlated two-quadrant questions and rejects mismatched maps", () => {
    const scenario = structuredClone(baseScenario) as unknown as Record<string, unknown>;
    const question = (scenario.phases as Array<Record<string, unknown>>)[2]!;
    question.field = {
      type: "two-quadrant",
      axis: "x",
      labels: { minLabel: "disagree", maxLabel: "agree" },
    };
    question.next = {
      type: "quadrant-plurality",
      map: { min: "idle", max: "idle" },
      tie: "idle",
      empty: "idle",
      countedStatuses: ["valid"],
    };
    const legacyParsed = scenarioSchema.safeParse(scenario);
    expect(legacyParsed.success).toBe(true);
    if (legacyParsed.success) {
      const parsedQuestion = legacyParsed.data.phases[2];
      if (parsedQuestion?.kind !== "position-question" || parsedQuestion.field.type !== "two-quadrant") throw new Error("expected two-quadrant question");
      expect(parsedQuestion.field.variant).toBe("spectrum");
    }

    (question.field as Record<string, unknown>).variant = "split";
    expect(scenarioSchema.safeParse(scenario).success).toBe(true);
    (question.field as Record<string, unknown>).variant = "diagonal";
    expect(scenarioSchema.safeParse(scenario).success).toBe(false);
    (question.field as Record<string, unknown>).variant = "spectrum";

    (question.next as { map: unknown }).map = {
      q1: "idle", q2: "idle", q3: "idle", q4: "idle",
    };
    expect(scenarioSchema.safeParse(scenario).success).toBe(false);
  });

  it("rejects a missing phase id", () => {
    expect(parse((s) => ({ ...s, phases: [idle, { ...s.phases[1], id: "" }] })).success).toBe(false);
  });

  it("rejects non-positive durations", () => {
    expect(parse((s) => {
      (s.phases[1] as { expectedDurationMs: number }).expectedDurationMs = 0;
      return s;
    }).success).toBe(false);
    expect(parse((s) => {
      (s.phases[2] as { durationMs: number }).durationMs = -1;
      return s;
    }).success).toBe(false);
  });

  it("rejects malformed axes", () => {
    expect(parse((s) => {
      const q = s.phases[2] as Extract<Scenario["phases"][number], { kind: "position-question" }>;
      if (q.field.type === "four-quadrant") {
        q.field.xAxis = { minLabel: "", maxLabel: "b" };
      }
      return s;
    }).success).toBe(false);
  });

  it("rejects an incomplete quadrant map", () => {
    expect(parse((s) => {
      const q = s.phases[2] as { next: { map: Record<string, string> } };
      delete q.next.map["q3"];
      return s;
    }).success).toBe(false);
  });

  it("rejects invalid or duplicate counted statuses", () => {
    expect(parse((s) => {
      (s.phases[2] as { next: { countedStatuses: string[] } }).next.countedStatuses = ["never-moved"];
      return s;
    }).success).toBe(false);
    expect(parse((s) => {
      (s.phases[2] as { next: { countedStatuses: string[] } }).next.countedStatuses = ["valid", "valid"];
      return s;
    }).success).toBe(false);
    expect(parse((s) => {
      (s.phases[2] as { next: { countedStatuses: string[] } }).next.countedStatuses = [];
      return s;
    }).success).toBe(false);
  });
});

describe("polygon-zones and rating extensions", () => {
  const threeZoneField = {
    type: "polygon-zones" as const,
    zones: [
      { id: "apollon", label: "Apollon", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
      { id: "dionysos", label: "Dionysos", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
      { id: "kassandra", label: "Kassandra", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.7, y: 1 }] },
    ],
  };

  it("accepts a polygon-zones question with a matching map", () => {
    const result = parse((s) => ({
      ...s,
      phases: [
        ...s.phases,
        {
          kind: "position-question" as const,
          id: "election",
          text: "Choose your statue",
          field: threeZoneField,
          durationMs: 60_000,
          freezeMs: 3_000,
          connectionStaleAfterMs: 30_000,
          showLiveCounts: true,
          next: {
            type: "quadrant-plurality" as const,
            map: { apollon: "idle", dionysos: "idle", kassandra: "idle" },
            tie: "idle",
            empty: "idle",
            countedStatuses: ["valid" as const],
          },
        },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("rejects a polygon-zones map whose keys don't match the zone ids", () => {
    const result = parse((s) => ({
      ...s,
      phases: [
        ...s.phases,
        {
          kind: "position-question" as const,
          id: "election",
          text: "Choose your statue",
          field: threeZoneField,
          durationMs: 60_000,
          freezeMs: 3_000,
          connectionStaleAfterMs: 30_000,
          showLiveCounts: true,
          next: {
            type: "quadrant-plurality" as const,
            map: { apollon: "idle", dionysos: "idle" }, // missing kassandra
            tie: "idle",
            empty: "idle",
            countedStatuses: ["valid" as const],
          },
        },
      ],
    }));
    expect(result.success).toBe(false);
  });

  it("accepts one zone and rejects an empty or duplicate zone list", () => {
    expect(polygonZonesFieldSchema.safeParse({ type: "polygon-zones", zones: [threeZoneField.zones[0]] }).success).toBe(true);
    expect(polygonZonesFieldSchema.safeParse({ type: "polygon-zones", zones: [] }).success).toBe(false);
    expect(
      polygonZonesFieldSchema.safeParse({
        type: "polygon-zones",
        zones: [threeZoneField.zones[0], threeZoneField.zones[0]],
      }).success,
    ).toBe(false);
  });

  it("accepts an optional rating config on video phases", () => {
    const result = parse((s) => ({
      ...s,
      phases: s.phases.map((phase) =>
        phase.id === "intro" ? { ...phase, rating: { candidateLabel: "OpenApollo" } } : phase,
      ),
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phases.find((p) => p.id === "intro")).toMatchObject({
        rating: { candidateLabel: "OpenApollo" },
      });
    }
  });

  it("rejects an empty rating candidateLabel", () => {
    const result = parse((s) => ({
      ...s,
      phases: s.phases.map((phase) =>
        phase.id === "intro" ? { ...phase, rating: { candidateLabel: "" } } : phase,
      ),
    }));
    expect(result.success).toBe(false);
  });
});

describe("validateScenario graph checks", () => {
  it("passes the base scenario", () => {
    const result = validateScenario(baseScenario);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects duplicate phase ids", () => {
    const s = structuredClone(baseScenario);
    s.phases.push(structuredClone(s.phases[1]!));
    const result = validateScenario(s);
    expect(result.errors.some((e) => e.code === "duplicate-phase-id")).toBe(true);
  });

  it("requires the idle phase", () => {
    const s = structuredClone(baseScenario);
    s.phases = s.phases.filter((p) => p.id !== "idle") as typeof s.phases;
    // quadrant map still points at idle, so broken targets are also reported
    const result = validateScenario(s);
    expect(result.errors.some((e) => e.code === "missing-idle-phase")).toBe(true);
  });

  it("rejects an unknown entry phase", () => {
    const s = structuredClone(baseScenario);
    s.entryPhaseId = "nope";
    const result = validateScenario(s);
    expect(result.errors.some((e) => e.code === "unknown-entry-phase")).toBe(true);
  });

  it("rejects broken fixed, quadrant, tie, and empty targets", () => {
    const s = structuredClone(baseScenario);
    const q = s.phases[2] as Extract<Scenario["phases"][number], { kind: "position-question" }>;
    if (q.next.type === "quadrant-plurality" && "q2" in q.next.map) {
      q.next.map.q2 = "ghost-a";
      q.next.tie = "ghost-b";
      q.next.empty = "ghost-c";
    }
    const result = validateScenario(s);
    const broken = result.errors.filter((e) => e.code === "broken-target");
    expect(broken).toHaveLength(3);
  });

  it("checks zone targets for polygon-zones questions", () => {
    const s = scenarioSchema.parse(structuredClone(baseScenario));
    const q = s.phases[2];
    if (q?.kind !== "position-question") throw new Error("expected question");
    q.field = {
      type: "polygon-zones",
      zones: [
        { id: "a", label: "A", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }] },
        { id: "b", label: "B", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
      ],
    };
    q.next = {
      type: "quadrant-plurality",
      map: { a: "ghost-a", b: "ghost-b" },
      tie: "idle",
      empty: "idle",
      countedStatuses: ["valid"],
    };
    const broken = validateScenario(s).errors.filter((e) => e.code === "broken-target");
    expect(broken.map((e) => e.message)).toEqual([
      'phase "q1" next.map.a points to unknown phase "ghost-a"',
      'phase "q1" next.map.b points to unknown phase "ghost-b"',
    ]);
  });

  it("checks min/max targets for two-quadrant questions", () => {
    const s = scenarioSchema.parse(structuredClone(baseScenario));
    const q = s.phases[2];
    if (q?.kind !== "position-question") throw new Error("expected question");
    q.field = {
      type: "two-quadrant",
      axis: "y",
      variant: "spectrum",
      labels: { minLabel: "top", maxLabel: "bottom" },
    };
    q.next = {
      type: "quadrant-plurality",
      map: { min: "ghost-min", max: "ghost-max" },
      tie: "idle",
      empty: "idle",
      countedStatuses: ["valid"],
    };
    const broken = validateScenario(s).errors.filter((e) => e.code === "broken-target");
    expect(broken.map((e) => e.message)).toEqual([
      'phase "q1" next.map.min points to unknown phase "ghost-min"',
      'phase "q1" next.map.max points to unknown phase "ghost-max"',
    ]);
  });

  it("rejects media referenced by videos but missing from the manifest", () => {
    const manifest: MediaManifest = { files: [] };
    const result = validateScenario(baseScenario, manifest);
    expect(result.errors.some((e) => e.code === "missing-media")).toBe(true);
  });

  it("warns on unreachable phases", () => {
    const s: Scenario = structuredClone(baseScenario);
    s.phases.push(question("orphan", idle));
    const result = validateScenario(s);
    expect(result.ok).toBe(true); // warning, not error
    expect(result.warnings.some((w) => w.code === "unreachable-phase" && w.phaseId === "orphan")).toBe(true);
  });

  it("rejects unmarked cycles and allows marked ones", () => {
    const s = structuredClone(baseScenario);
    const q = s.phases[2] as Extract<Scenario["phases"][number], { kind: "position-question" }>;
    if (q.next.type === "quadrant-plurality") q.next.tie = "intro"; // intro -> q1 -> intro
    expect(validateScenario(s).errors.some((e) => e.code === "unmarked-cycle")).toBe(true);

    const marked = { ...structuredClone(s), cyclesAllowed: true };
    expect(validateScenario(marked).errors.some((e) => e.code === "unmarked-cycle")).toBe(false);
  });
});

describe("validateMediaManifest", () => {
  const manifest = mediaManifestSchema.parse({
    files: [
      { src: "intro.mp4", bytes: 1_000, hash: "abc" },
      { src: "other.mp4", bytes: 2_000, hash: "def" },
    ],
  });

  const statFrom = (sizes: Record<string, number>) => async (src: string) => {
    const size = sizes[src];
    if (size === undefined) throw new Error("missing");
    return size;
  };

  it("passes when declared sizes match", async () => {
    const result = await validateMediaManifest(
      manifest,
      statFrom({ "intro.mp4": 1_000, "other.mp4": 2_000 }),
    );
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(3_000);
  });

  it("rejects missing files and size mismatches", async () => {
    const result = await validateMediaManifest(
      manifest,
      statFrom({ "intro.mp4": 999 }),
    );
    expect(result.errors.map((e) => e.code).sort()).toEqual([
      "file-missing",
      "size-mismatch",
    ]);
  });

  it("rejects totals above the 2 GiB budget", async () => {
    const big = mediaManifestSchema.parse({
      files: [{ src: "huge.mp4", bytes: 2 * 1024 * 1024 * 1024 + 1, hash: "x" }],
    });
    const result = await validateMediaManifest(
      big,
      statFrom({ "huge.mp4": 2 * 1024 * 1024 * 1024 + 1 }),
    );
    expect(result.errors.some((e) => e.code === "budget-exceeded")).toBe(true);
  });
});
