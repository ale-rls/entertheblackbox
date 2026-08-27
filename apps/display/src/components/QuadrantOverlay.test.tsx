import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type QuestionResolvedMessage,
} from "@smartphonecracy/protocol";
import {
  QuadrantOverlay,
  type QuestionField,
} from "./QuadrantOverlay.js";

const fourField: QuestionField = {
  type: "four-quadrant",
  xAxis: { minLabel: "left", maxLabel: "right" },
  yAxis: { minLabel: "top", maxLabel: "bottom" },
};

const twoXField: QuestionField = {
  type: "two-quadrant",
  axis: "x",
  labels: { minLabel: "disagree", maxLabel: "agree" },
};

const twoYField: QuestionField = {
  type: "two-quadrant",
  axis: "y",
  labels: { minLabel: "local", maxLabel: "global" },
};

const zonesField: QuestionField = {
  type: "polygon-zones",
  zones: [
    { id: "apollon", label: "Apollon", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
    { id: "dionysos", label: "Dionysos", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
    { id: "kassandra", label: "Kassandra", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.7, y: 1 }] },
  ],
};

function resolved(
  field: QuestionField,
  winner: "min" | "max" | "tie" | "empty" | "fixed",
): QuestionResolvedMessage {
  return {
    t: "question_resolved",
    v: PROTOCOL_VERSION,
    sessionId: "session-1",
    phaseEpoch: 2,
    field,
    quadrantCounts: { min: 3, max: 5 },
    winner,
    resolvedTarget: "next",
    freezeUntil: 10_000,
  } as unknown as QuestionResolvedMessage;
}

describe("QuadrantOverlay", () => {
  it("preserves the four-quadrant cross, axes, positions, and counts", () => {
    const html = renderToStaticMarkup(
      <QuadrantOverlay
        field={fourField}
        liveField={fourField}
        liveCounts={{ q1: 1, q2: 2, q3: 3, q4: 4 }}
        resolution={null}
      />,
    );

    expect(html).toContain('class="axis axis-x"');
    expect(html).toContain('class="axis axis-y"');
    expect(html).toContain('class="axis-cross"');
    expect(html.match(/data-quadrant=/g)).toHaveLength(4);
    expect(html).toContain('class="quadrant quadrant-top-right" data-quadrant="q1"');
    expect(html).toContain('data-quadrant="q4"><span class="quadrant-count">4</span>');
  });

  it("renders an X two-quadrant field with one divider and only X labels", () => {
    const html = renderToStaticMarkup(
      <QuadrantOverlay
        field={twoXField}
        liveField={twoXField}
        liveCounts={{ min: 7, max: 9 }}
        resolution={null}
      />,
    );

    expect(html).toContain('class="axis axis-x"');
    expect(html).not.toContain('class="axis axis-y"');
    expect(html).toContain('class="axis-divider axis-divider-x"');
    expect(html.match(/class="axis-divider /g)).toHaveLength(1);
    expect(html).not.toContain("axis-cross");
    expect(html.match(/data-quadrant=/g)).toHaveLength(2);
    expect(html).toContain('class="quadrant quadrant-left" data-quadrant="min"');
    expect(html).toContain('class="quadrant quadrant-right" data-quadrant="max"');
    expect(html).toContain("disagree");
    expect(html).toContain("agree");
  });

  it("renders a Y two-quadrant winner using top/bottom min/max regions", () => {
    const html = renderToStaticMarkup(
      <QuadrantOverlay
        field={twoYField}
        liveField={null}
        liveCounts={null}
        resolution={resolved(twoYField, "max")}
      />,
    );

    expect(html).toContain('class="axis axis-y"');
    expect(html).not.toContain('class="axis axis-x"');
    expect(html).toContain('class="axis-divider axis-divider-y"');
    expect(html.match(/class="axis-divider /g)).toHaveLength(1);
    expect(html).toContain(
      'class="quadrant quadrant-top quadrant-dimmed" data-quadrant="min"',
    );
    expect(html).toContain(
      'class="quadrant quadrant-bottom quadrant-winner" data-quadrant="max"',
    );
  });

  it("does not render live counts from a mismatched field", () => {
    const html = renderToStaticMarkup(
      <QuadrantOverlay
        field={twoXField}
        liveField={twoYField}
        liveCounts={{ min: 7, max: 9 }}
        resolution={null}
      />,
    );

    expect(html).not.toContain("quadrant-count");
  });

  it("renders tie and empty outcomes while fixed freezes counts neutrally", () => {
    const tie = renderToStaticMarkup(
      <QuadrantOverlay
        field={twoXField}
        liveField={null}
        liveCounts={null}
        resolution={resolved(twoXField, "tie")}
      />,
    );
    expect(tie.match(/quadrant-dimmed/g)).toHaveLength(2);
    expect(tie).toContain('class="outcome outcome-tie">tie</div>');

    const empty = renderToStaticMarkup(
      <QuadrantOverlay
        field={twoXField}
        liveField={null}
        liveCounts={null}
        resolution={resolved(twoXField, "empty")}
      />,
    );
    expect(empty.match(/quadrant-dimmed/g)).toHaveLength(2);
    expect(empty).toContain('class="outcome outcome-empty"');

    const fixed = renderToStaticMarkup(
      <QuadrantOverlay
        field={twoXField}
        liveField={null}
        liveCounts={null}
        resolution={resolved(twoXField, "fixed")}
      />,
    );
    expect(fixed).toContain('class="quadrant-count">3</span>');
    expect(fixed).toContain('class="quadrant-count">5</span>');
    expect(fixed).not.toContain("quadrant-winner");
    expect(fixed).not.toContain("quadrant-dimmed");
    expect(fixed).not.toContain('class="outcome');
  });

  it("renders polygon zones as SVG shapes with centroid labels and counts", () => {
    const html = renderToStaticMarkup(
      <QuadrantOverlay
        field={zonesField}
        liveField={zonesField}
        liveCounts={{ apollon: 1, dionysos: 2, kassandra: 0 }}
        resolution={null}
      />,
    );

    expect(html).toContain('class="quadrant-overlay quadrant-overlay-polygon-zones"');
    expect(html.match(/class="zone-shape"/g)).toHaveLength(3);
    expect(html).toContain("Apollon");
    expect(html).toContain("Dionysos");
    expect(html).toContain("Kassandra");
    expect(html).toContain('<span class="zone-count">2</span>');
  });

  it("highlights the winning zone and dims the rest", () => {
    const resolution = {
      t: "question_resolved" as const,
      v: PROTOCOL_VERSION,
      sessionId: "session-1",
      phaseEpoch: 2,
      field: zonesField,
      quadrantCounts: { apollon: 1, dionysos: 2, kassandra: 0 },
      winner: "dionysos",
      resolvedTarget: "next",
      freezeUntil: 10_000,
    } as unknown as QuestionResolvedMessage;

    const html = renderToStaticMarkup(
      <QuadrantOverlay field={zonesField} liveField={null} liveCounts={null} resolution={resolution} />,
    );

    expect(html).toContain("zone-shape-winner");
    expect(html.match(/zone-shape-dimmed/g)).toHaveLength(2);
    expect(html).not.toContain('class="outcome');
  });

  it("shows and highlights the deterministic Kleroterion selection for a tied zone vote", () => {
    const resolution = {
      t: "question_resolved" as const,
      v: PROTOCOL_VERSION,
      sessionId: "session-1",
      phaseEpoch: 2,
      field: zonesField,
      quadrantCounts: { apollon: 2, dionysos: 2, kassandra: 0 },
      winner: "tie" as const,
      resolvedTarget: "dionysos-vision",
      freezeUntil: 10_000,
      tieBreak: { type: "kleroterion" as const, candidates: ["apollon", "dionysos"], selected: "dionysos" },
    } as QuestionResolvedMessage;

    const html = renderToStaticMarkup(
      <QuadrantOverlay field={zonesField} liveField={null} liveCounts={null} resolution={resolution} />,
    );
    expect(html).toContain("Kleroterion · Dionysos");
    expect(html).toContain("zone-shape-winner");
    expect(html.match(/zone-shape-dimmed/g)).toHaveLength(2);
  });
});
