import type {
  QuestionResolvedMessage,
  QuestionStatusMessage,
} from "@smartphonecracy/protocol";
import type { Axis, PolygonZonesField, PositionField } from "@smartphonecracy/scenario";

export type AxisLabels = Axis;
export type QuestionField = PositionField;

type FourQuadrant = "q1" | "q2" | "q3" | "q4";
type TwoQuadrant = "min" | "max";
type FourQuadrantCounts = Record<FourQuadrant, number>;
type TwoQuadrantCounts = Record<TwoQuadrant, number>;
type PositionCounts = NonNullable<QuestionStatusMessage["quadrantCounts"]>;

const FOUR_QUADRANT_POSITIONS: Record<FourQuadrant, string> = {
  q1: "top-right",
  q2: "top-left",
  q3: "bottom-left",
  q4: "bottom-right",
};

const TWO_QUADRANT_POSITIONS = {
  x: { min: "left", max: "right" },
  y: { min: "top", max: "bottom" },
} as const;

function isFourQuadrantCounts(
  counts: PositionCounts,
): counts is PositionCounts & FourQuadrantCounts {
  return "q1" in counts && "q2" in counts && "q3" in counts && "q4" in counts;
}

function isTwoQuadrantCounts(
  counts: PositionCounts,
): counts is PositionCounts & TwoQuadrantCounts {
  return "min" in counts && "max" in counts;
}

/** Anything that isn't the fixed q1-q4/min-max shapes is a zone-id-keyed record. */
function isPolygonZonesCounts(counts: PositionCounts): counts is Record<string, number> {
  return !isFourQuadrantCounts(counts) && !isTwoQuadrantCounts(counts);
}

function sameField(left: QuestionField, right: QuestionField): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "two-quadrant") return right.type === "two-quadrant" && left.axis === right.axis;
  if (left.type === "polygon-zones") {
    return (
      right.type === "polygon-zones" &&
      left.zones.length === right.zones.length &&
      left.zones.every((zone, i) => zone.id === right.zones[i]?.id)
    );
  }
  return true; // four-quadrant: no sub-shape to compare
}

function centroid(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Arbitrary-polygon zones (e.g. a 3-way statue vote). Shapes render in an
 * SVG stretched to the arena's aspect ratio; labels/counts render as plain
 * HTML positioned at each zone's centroid so text never gets skewed by a
 * non-uniform SVG scale.
 */
function PolygonZoneOverlay({
  field,
  counts,
  winner,
}: {
  field: PolygonZonesField;
  counts: Record<string, number> | null;
  winner: string | null;
}) {
  return (
    <div className="quadrant-overlay quadrant-overlay-polygon-zones">
      <svg className="zone-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {field.zones.map((zone) => (
          <polygon
            key={zone.id}
            className={[
              "zone-shape",
              winner === zone.id ? "zone-shape-winner" : "",
              winner !== null && winner !== zone.id ? "zone-shape-dimmed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            points={zone.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
          />
        ))}
      </svg>
      {field.zones.map((zone) => {
        const c = centroid(zone.points);
        return (
          <div
            key={zone.id}
            className={[
              "zone-label",
              winner === zone.id ? "zone-label-winner" : "",
              winner !== null && winner !== zone.id ? "zone-label-dimmed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
          >
            <span className="zone-name">{zone.label}</span>
            {counts !== null && <span className="zone-count">{counts[zone.id] ?? 0}</span>}
          </div>
        );
      })}
      {winner === "tie" && <div className="outcome outcome-tie">tie</div>}
      {winner === "empty" && <div className="outcome outcome-empty" />}
    </div>
  );
}

function Axis({ axis, labels }: { axis: "x" | "y"; labels: AxisLabels }) {
  return (
    <div className={`axis axis-${axis}`} data-active-axis={axis}>
      <span>{labels.minLabel}</span>
      <span>{labels.maxLabel}</span>
    </div>
  );
}

function Region({
  id,
  position,
  count,
  winner,
}: {
  id: FourQuadrant | TwoQuadrant;
  position: string;
  count: number | null;
  winner: string | null;
}) {
  return (
    <div
      className={[
        "quadrant",
        `quadrant-${position}`,
        winner === id ? "quadrant-winner" : "",
        winner !== null && winner !== id ? "quadrant-dimmed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-quadrant={id}
    >
      {count !== null && <span className="quadrant-count">{count}</span>}
    </div>
  );
}

/**
 * Spatial question field with pinned four-quadrant naming and two-quadrant
 * min/max naming. Two-quadrant X fields split left/right; Y fields split
 * top/bottom. The server remains the resolution oracle: this component only
 * renders the field, counts, and the frozen outcome it receives.
 */
export function QuadrantOverlay({
  field,
  liveField,
  liveCounts,
  resolution,
}: {
  field: QuestionField;
  liveField: QuestionField | null;
  liveCounts: PositionCounts | null;
  resolution: QuestionResolvedMessage | null;
}) {
  const resolutionMatches =
    resolution !== null && sameField(field, resolution.field);
  const resolvedCounts = resolutionMatches ? resolution.quadrantCounts : null;
  const matchingLiveCounts =
    liveField !== null && sameField(field, liveField) ? liveCounts : null;
  const countSource = resolution === null ? matchingLiveCounts : resolvedCounts;
  const winner =
    !resolutionMatches || resolution.winner === "fixed"
      ? null
      : resolution.winner;

  if (field.type === "polygon-zones") {
    const counts =
      countSource !== null && isPolygonZonesCounts(countSource) ? countSource : null;
    return (
      <PolygonZoneOverlay
        field={field}
        counts={counts}
        winner={winner === "tie" || winner === "empty" ? winner : (winner as string | null)}
      />
    );
  }

  if (field.type === "four-quadrant") {
    const counts =
      countSource !== null && isFourQuadrantCounts(countSource)
        ? countSource
        : null;
    return (
      <>
        <Axis axis="x" labels={field.xAxis} />
        <Axis axis="y" labels={field.yAxis} />
        <div className="quadrant-overlay quadrant-overlay-four-quadrant">
          <div className="axis-cross" aria-hidden />
          {(Object.keys(FOUR_QUADRANT_POSITIONS) as FourQuadrant[]).map((id) => (
            <Region
              key={id}
              id={id}
              position={FOUR_QUADRANT_POSITIONS[id]}
              count={counts?.[id] ?? null}
              winner={winner}
            />
          ))}
          {winner === "tie" && <div className="outcome outcome-tie">tie</div>}
          {winner === "empty" && <div className="outcome outcome-empty" />}
        </div>
      </>
    );
  }

  const counts =
    countSource !== null && isTwoQuadrantCounts(countSource) ? countSource : null;
  const positions = TWO_QUADRANT_POSITIONS[field.axis];
  return (
    <>
      <Axis axis={field.axis} labels={field.labels} />
      <div
        className={`quadrant-overlay quadrant-overlay-two-quadrant quadrant-overlay-axis-${field.axis}`}
      >
        <div className={`axis-divider axis-divider-${field.axis}`} aria-hidden />
        {(["min", "max"] as const).map((id) => (
          <Region
            key={id}
            id={id}
            position={positions[id]}
            count={counts?.[id] ?? null}
            winner={winner}
          />
        ))}
        {winner === "tie" && <div className="outcome outcome-tie">tie</div>}
        {winner === "empty" && <div className="outcome outcome-empty" />}
      </div>
    </>
  );
}
