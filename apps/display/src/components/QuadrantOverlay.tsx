import type {
  QuestionResolvedMessage,
  QuestionStatusMessage,
} from "@smartphonecracy/protocol";
import type { Arena, ArenaEllipse, ArenaQuad, Axis, PolygonZonesField, PositionField } from "@smartphonecracy/scenario";
import { arenaEllipseSplitY, arenaQuadFourRegions, arenaQuadLandmarks, arenaQuadTwoRegions, centroid } from "@smartphonecracy/shared";

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

function sameArena(a: Arena | undefined, b: Arena | undefined): boolean {
  if (a === undefined) return b === undefined;
  if (b === undefined || a.type !== b.type) return false;
  if (a.type === "ellipse") {
    return b.type === "ellipse" && a.centerX === b.centerX && a.centerY === b.centerY && a.radiusX === b.radiusX && a.radiusY === b.radiusY && arenaEllipseSplitY(a) === arenaEllipseSplitY(b);
  }
  return b.type === "quad" && a.corners.every((corner, i) => corner.x === b.corners[i]?.x && corner.y === b.corners[i]?.y);
}

function sameField(left: QuestionField, right: QuestionField): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "two-quadrant") return right.type === "two-quadrant" && left.axis === right.axis && (left.variant ?? "spectrum") === (right.variant ?? "spectrum") && sameArena(left.arena, right.arena);
  if (left.type === "polygon-zones") {
    return (
      right.type === "polygon-zones" &&
      left.zones.length === right.zones.length &&
      left.zones.every((zone, i) => zone.id === right.zones[i]?.id)
    );
  }
  return right.type === "four-quadrant" && sameArena(left.arena, right.arena);
}

function regionLabel(field: Exclude<QuestionField, PolygonZonesField>, id: string): string {
  if (field.type === "two-quadrant") return id === "min" ? field.labels.minLabel : field.labels.maxLabel;
  return id;
}

/** Keeps a label's placement from running off either side of the screen. */
function clampPercent(value: number, min = 6, max = 94): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The field's own arena center (the ellipse/quad "circle", or a
 * perspective-skewed quad's true midpoint), in the same 0-100 percentage
 * space the overlay itself renders in. `null` for fields with no arena
 * (e.g. a plain four-quadrant cross or polygon zones), where there's no
 * off-screen-center point to aim at.
 */
export function questionFieldCenter(field: QuestionField): { x: number; y: number } | null {
  if (field.type === "polygon-zones" || field.arena === undefined) return null;
  if (field.arena.type === "ellipse") {
    return { x: field.arena.centerX * 100, y: field.arena.centerY * 100 };
  }
  const { center } = arenaQuadLandmarks(field.arena.corners);
  return { x: center.x * 100, y: center.y * 100 };
}

const svgPoints = (points: readonly { x: number; y: number }[]): string =>
  points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");

const ZONE_LABEL_BOTTOM_PERCENT = 86;

/**
 * Arbitrary-polygon zones (e.g. a 3-way statue vote). Shapes render in an
 * SVG stretched to the arena's aspect ratio; labels/counts render as plain
 * HTML aligned along a common bottom row (horizontally at each zone's
 * centroid) so text never gets skewed by a non-uniform SVG scale.
 */
function PolygonZoneOverlay({
  field,
  counts,
  winner,
  lotterySelected,
  highlightRegionIds,
}: {
  field: PolygonZonesField;
  counts: Record<string, number> | null;
  winner: string | null;
  lotterySelected: string | null;
  highlightRegionIds: readonly string[];
}) {
  return (
    <div className="quadrant-overlay quadrant-overlay-polygon-zones">
      {/* The perspective-warped zone borders are only useful once there's an
          outcome to point at -- otherwise they just clutter the shot. */}
      {winner !== null && (
        <svg className="zone-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {field.zones.map((zone) => (
            <polygon
              key={zone.id}
              className={[
                "zone-shape",
                winner === zone.id ? "zone-shape-winner" : "",
                winner !== zone.id ? "zone-shape-dimmed" : "",
                highlightRegionIds.includes(zone.id) ? "zone-shape-blink" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              points={svgPoints(zone.points)}
            />
          ))}
        </svg>
      )}
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
            style={{ left: `${clampPercent(c.x * 100)}%`, top: `${ZONE_LABEL_BOTTOM_PERCENT}%` }}
          >
            <span className="zone-name">{zone.label}</span>
            {counts !== null && <span className="zone-count">{counts[zone.id] ?? 0}</span>}
          </div>
        );
      })}
      {winner === "tie" && lotterySelected === null && <div className="outcome outcome-tie">Gleichstand</div>}
      {lotterySelected !== null && <div className="outcome outcome-kleroterion">Lottokratie entscheidet… {field.zones.find((zone) => zone.id === lotterySelected)?.label ?? lotterySelected}</div>}
      {winner === "empty" && <div className="outcome outcome-empty" />}
    </div>
  );
}

function Axis({ axis, labels }: { axis: "x" | "y"; labels: AxisLabels }) {
  return (
    <div className={`axis axis-${axis}`} data-active-axis={axis}>
      <span className="axis-label axis-label-min">{labels.minLabel}</span>
      <span className="axis-label axis-label-max">{labels.maxLabel}</span>
    </div>
  );
}

function Region({
  id,
  position,
  count,
  winner,
  highlight = false,
}: {
  id: FourQuadrant | TwoQuadrant;
  position: string;
  count: number | null;
  winner: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        "quadrant",
        `quadrant-${position}`,
        winner === id ? "quadrant-winner" : "",
        winner !== null && winner !== id ? "quadrant-dimmed" : "",
        highlight ? "quadrant-blink" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-quadrant={id}
    >
      {count !== null && <span className="quadrant-count">{count}</span>}
    </div>
  );
}

function arenaRegionClass(id: string, winner: string | null, highlightRegionId: string | null): string {
  return [
    "arena-region",
    `arena-region-${id}`,
    winner === id ? "arena-region-winner" : "",
    winner !== null && winner !== id ? "arena-region-dimmed" : "",
    highlightRegionId === id ? "arena-region-blink" : "",
  ].filter(Boolean).join(" ");
}

function ArenaLabel({
  axis,
  endpoint,
  label,
  x,
  y,
}: {
  axis: "x" | "y";
  endpoint: "min" | "max";
  label: string;
  x: number;
  y: number;
}) {
  return <span
    className={`arena-axis-label arena-axis-label-${axis} arena-axis-label-${endpoint}`}
    style={{ left: `${x}%`, top: `${y}%` }}
  >{label}</span>;
}

/**
 * Arena-aware renderer. The visible outline, clipped regions, divider lines,
 * labels, and server-side hit testing all use the same normalized ellipse.
 */
function ArenaEllipseOverlay({
  field,
  counts,
  winner,
  showCounts,
  highlightRegionIds,
  lotterySelected,
}: {
  field: Exclude<QuestionField, PolygonZonesField> & { arena: ArenaEllipse };
  counts: FourQuadrantCounts | TwoQuadrantCounts | null;
  winner: string | null;
  showCounts: boolean;
  highlightRegionIds: readonly string[];
  lotterySelected: string | null;
}) {
  const { centerX, centerY, radiusX, radiusY } = field.arena;
  const cx = centerX * 100;
  const cy = centerY * 100;
  const rx = radiusX * 100;
  const ry = radiusY * 100;
  const sy = arenaEllipseSplitY(field.arena) * 100;
  const splitHalfWidth = rx * Math.sqrt(Math.max(0, 1 - ((sy - cy) / ry) ** 2));
  const ids: Array<FourQuadrant | TwoQuadrant> = field.type === "four-quadrant"
    ? ["q1", "q2", "q3", "q4"]
    : ["min", "max"];
  const regionRect = (id: FourQuadrant | TwoQuadrant) => {
    if (field.type === "four-quadrant") {
      const right = id === "q1" || id === "q4";
      const bottom = id === "q3" || id === "q4";
      return { x: right ? cx : 0, y: bottom ? sy : 0, width: right ? 100 - cx : cx, height: bottom ? 100 - sy : sy };
    }
    if (field.axis === "x") {
      const right = id === "max";
      return { x: right ? cx : 0, y: 0, width: right ? 100 - cx : cx, height: 100 };
    }
    const bottom = id === "max";
    return { x: 0, y: bottom ? sy : 0, width: 100, height: bottom ? 100 - sy : sy };
  };
  const countPosition = (id: FourQuadrant | TwoQuadrant) => {
    if (field.type === "four-quadrant") {
      const right = id === "q1" || id === "q4";
      const bottom = id === "q3" || id === "q4";
      const edgeY = cy + (bottom ? ry : -ry);
      return { x: cx + (right ? 0.42 : -0.42) * rx, y: sy + 0.42 * (edgeY - sy) };
    }
    return field.axis === "x"
      ? { x: cx + (id === "max" ? 0.5 : -0.5) * rx, y: cy }
      : { x: cx, y: sy + 0.5 * (cy + (id === "max" ? ry : -ry) - sy) };
  };
  const labels = field.type === "four-quadrant"
    ? { x: field.xAxis, y: field.yAxis }
    : { [field.axis]: field.labels } as Partial<Record<"x" | "y", AxisLabels>>;
  const spectrum = field.type === "two-quadrant" && field.variant !== "split";
  const horizontalLine = field.type === "four-quadrant" || (spectrum ? field.axis === "x" : field.axis === "y");
  const verticalLine = field.type === "four-quadrant" || (spectrum ? field.axis === "y" : field.axis === "x");
  const xLabelHalfWidth = field.type === "two-quadrant" && !spectrum ? rx : splitHalfWidth;
  const xLabelY = field.type === "two-quadrant" && !spectrum ? cy : sy;

  return <div className={`quadrant-overlay arena-ellipse-overlay arena-ellipse-${field.type}`}>
    <svg className="arena-ellipse-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <defs><clipPath id="arena-ellipse-clip"><ellipse cx={cx} cy={cy} rx={rx} ry={ry} /></clipPath></defs>
      <g clipPath="url(#arena-ellipse-clip)">
        {ids.map((id) => <rect key={id} data-quadrant={id} className={arenaRegionClass(id, winner, highlightRegionIds.includes(id) ? id : null)} {...regionRect(id)} />)}
        {horizontalLine && <line className={spectrum ? "arena-spectrum-axis" : "arena-divider"} x1={cx - splitHalfWidth} y1={sy} x2={cx + splitHalfWidth} y2={sy} />}
        {verticalLine && <line className={spectrum ? "arena-spectrum-axis" : "arena-divider"} x1={cx} y1={cy - ry} x2={cx} y2={cy + ry} />}
        {spectrum && <circle className="arena-spectrum-origin" cx={cx} cy={sy} r="0.8" />}
      </g>
      <ellipse className="arena-outline" cx={cx} cy={cy} rx={rx} ry={ry} />
    </svg>
    {labels.x && <>
      <ArenaLabel axis="x" endpoint="min" label={labels.x.minLabel} x={clampPercent(cx - xLabelHalfWidth, 9, 91)} y={xLabelY} />
      <ArenaLabel axis="x" endpoint="max" label={labels.x.maxLabel} x={clampPercent(cx + xLabelHalfWidth, 9, 91)} y={xLabelY} />
    </>}
    {labels.y && <>
      <ArenaLabel axis="y" endpoint="min" label={labels.y.minLabel} x={cx} y={cy - ry} />
      <ArenaLabel axis="y" endpoint="max" label={labels.y.maxLabel} x={cx} y={cy + ry} />
    </>}
    {showCounts && ids.map((id) => {
      const position = countPosition(id);
      const count = counts?.[id as keyof typeof counts];
      return <div
        key={id}
        className={["arena-count", winner !== null && winner !== id ? "arena-count-dimmed" : "", winner === id ? "arena-count-winner" : ""].filter(Boolean).join(" ")}
        style={{ left: `${position.x}%`, top: `${position.y}%` }}
      >{count !== undefined && <span className="quadrant-count">{count}</span>}</div>;
    })}
    {winner === "tie" && lotterySelected === null && <div className="outcome outcome-tie">Gleichstand</div>}
    {lotterySelected !== null && <div className="outcome outcome-kleroterion">Lottokratie entscheidet… {regionLabel(field, lotterySelected)}</div>}
    {winner !== null && winner !== "tie" && winner !== "empty" && <div className="outcome outcome-majority">Mehrheit: {field.type === "two-quadrant" ? (winner === "min" ? field.labels.minLabel : field.labels.maxLabel) : winner}</div>}
    {winner === "empty" && <div className="outcome outcome-empty" />}
  </div>;
}

/**
 * Perspective-calibrated renderer for a quad arena: regions, divider
 * lines, and label/count anchors are all derived from the quad's own edge
 * midpoints (arenaQuadLandmarks) rather than a center + radius, so a
 * skewed trapezoid (e.g. a circular floor filmed at an angle) renders
 * true to the calibrated shape instead of an idealized ellipse.
 */
function ArenaQuadOverlay({
  field,
  counts,
  winner,
  showCounts,
  highlightRegionIds,
  lotterySelected,
}: {
  field: Exclude<QuestionField, PolygonZonesField> & { arena: ArenaQuad };
  counts: FourQuadrantCounts | TwoQuadrantCounts | null;
  winner: string | null;
  showCounts: boolean;
  highlightRegionIds: readonly string[];
  lotterySelected: string | null;
}) {
  const { corners } = field.arena;
  const { topMid, rightMid, bottomMid, leftMid, center } = arenaQuadLandmarks(corners);
  const ids: Array<FourQuadrant | TwoQuadrant> = field.type === "four-quadrant"
    ? ["q1", "q2", "q3", "q4"]
    : ["min", "max"];
  const regions = field.type === "four-quadrant"
    ? arenaQuadFourRegions(corners)
    : arenaQuadTwoRegions(corners, field.axis);
  const labels = field.type === "four-quadrant"
    ? { x: field.xAxis, y: field.yAxis }
    : { [field.axis]: field.labels } as Partial<Record<"x" | "y", AxisLabels>>;
  const spectrum = field.type === "two-quadrant" && field.variant !== "split";
  const horizontalLine = field.type === "four-quadrant" || (spectrum ? field.axis === "x" : field.axis === "y");
  const verticalLine = field.type === "four-quadrant" || (spectrum ? field.axis === "y" : field.axis === "x");

  return <div className={`quadrant-overlay arena-ellipse-overlay arena-ellipse-${field.type}`}>
    <svg className="arena-ellipse-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {ids.map((id) => <polygon
        key={id}
        data-quadrant={id}
        className={arenaRegionClass(id, winner, highlightRegionIds.includes(id) ? id : null)}
        points={svgPoints(regions[id as keyof typeof regions])}
      />)}
      {horizontalLine && <line className={spectrum ? "arena-spectrum-axis" : "arena-divider"} x1={leftMid.x * 100} y1={leftMid.y * 100} x2={rightMid.x * 100} y2={rightMid.y * 100} />}
      {verticalLine && <line className={spectrum ? "arena-spectrum-axis" : "arena-divider"} x1={topMid.x * 100} y1={topMid.y * 100} x2={bottomMid.x * 100} y2={bottomMid.y * 100} />}
      {spectrum && <circle className="arena-spectrum-origin" cx={center.x * 100} cy={center.y * 100} r="0.8" />}
      <polygon className="arena-outline" points={svgPoints(corners)} />
    </svg>
    {labels.x && <>
      <ArenaLabel axis="x" endpoint="min" label={labels.x.minLabel} x={clampPercent(leftMid.x * 100, 9, 91)} y={leftMid.y * 100} />
      <ArenaLabel axis="x" endpoint="max" label={labels.x.maxLabel} x={clampPercent(rightMid.x * 100, 9, 91)} y={rightMid.y * 100} />
    </>}
    {labels.y && <>
      <ArenaLabel axis="y" endpoint="min" label={labels.y.minLabel} x={topMid.x * 100} y={topMid.y * 100} />
      <ArenaLabel axis="y" endpoint="max" label={labels.y.maxLabel} x={bottomMid.x * 100} y={bottomMid.y * 100} />
    </>}
    {showCounts && ids.map((id) => {
      const position = centroid(regions[id as keyof typeof regions]);
      const count = counts?.[id as keyof typeof counts];
      return <div
        key={id}
        className={["arena-count", winner !== null && winner !== id ? "arena-count-dimmed" : "", winner === id ? "arena-count-winner" : ""].filter(Boolean).join(" ")}
        style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
      >{count !== undefined && <span className="quadrant-count">{count}</span>}</div>;
    })}
    {winner === "tie" && lotterySelected === null && <div className="outcome outcome-tie">Gleichstand</div>}
    {lotterySelected !== null && <div className="outcome outcome-kleroterion">Lottokratie entscheidet… {regionLabel(field, lotterySelected)}</div>}
    {winner !== null && winner !== "tie" && winner !== "empty" && <div className="outcome outcome-majority">Mehrheit: {field.type === "two-quadrant" ? (winner === "min" ? field.labels.minLabel : field.labels.maxLabel) : winner}</div>}
    {winner === "empty" && <div className="outcome outcome-empty" />}
  </div>;
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
  showCounts = true,
  highlightRegionId = null,
  highlightRegionIds = [],
}: {
  field: QuestionField;
  liveField: QuestionField | null;
  liveCounts: PositionCounts | null;
  resolution: QuestionResolvedMessage | null;
  showCounts?: boolean;
  highlightRegionId?: string | null;
  highlightRegionIds?: readonly string[];
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
  const lotterySelected = resolutionMatches ? resolution?.tieBreak?.selected ?? null : null;
  const resolvedHighlights = resolutionMatches
    ? resolution.tieBreak?.candidates
      ?? (winner === "tie" ? Object.keys(resolution.quadrantCounts) : winner === null || winner === "empty" ? [] : [winner])
    : [];
  const highlighted = [
    ...resolvedHighlights,
    ...highlightRegionIds,
    ...(highlightRegionId === null ? [] : [highlightRegionId]),
  ];

  if (field.type === "polygon-zones") {
    const counts =
      countSource !== null && isPolygonZonesCounts(countSource) ? countSource : null;
    return (
      <PolygonZoneOverlay
        field={field}
        counts={counts}
        winner={lotterySelected ?? (winner === "tie" || winner === "empty" ? winner : (winner as string | null))}
        lotterySelected={lotterySelected}
        highlightRegionIds={highlighted}
      />
    );
  }

  if (field.arena !== undefined) {
    const counts = field.type === "four-quadrant"
      ? countSource !== null && isFourQuadrantCounts(countSource) ? countSource : null
      : countSource !== null && isTwoQuadrantCounts(countSource) ? countSource : null;
    return field.arena.type === "quad"
      ? <ArenaQuadOverlay
          field={field as typeof field & { arena: ArenaQuad }}
          counts={counts}
          winner={winner}
          showCounts={showCounts}
          highlightRegionIds={highlighted}
          lotterySelected={lotterySelected}
        />
      : <ArenaEllipseOverlay
          field={field as typeof field & { arena: ArenaEllipse }}
          counts={counts}
          winner={winner}
          showCounts={showCounts}
          highlightRegionIds={highlighted}
          lotterySelected={lotterySelected}
        />;
  }

  if (field.type === "four-quadrant") {
    const counts =
      countSource !== null && isFourQuadrantCounts(countSource)
        ? countSource
        : null;
    return (
      <div className="quadrant-overlay quadrant-overlay-four-quadrant">
        <Axis axis="x" labels={field.xAxis} />
        <Axis axis="y" labels={field.yAxis} />
        <div className="axis-cross" aria-hidden>
          <span className="axis-arrow axis-arrow-left" />
          <span className="axis-arrow axis-arrow-right" />
          <span className="axis-arrow axis-arrow-top" />
          <span className="axis-arrow axis-arrow-bottom" />
        </div>
        {(Object.keys(FOUR_QUADRANT_POSITIONS) as FourQuadrant[]).map((id) => (
          <Region
            key={id}
            id={id}
            position={FOUR_QUADRANT_POSITIONS[id]}
            count={showCounts ? counts?.[id] ?? null : null}
            winner={winner}
            highlight={highlighted.includes(id)}
          />
        ))}
        {winner === "tie" && lotterySelected === null && <div className="outcome outcome-tie">Gleichstand</div>}
        {lotterySelected !== null && <div className="outcome outcome-kleroterion">Lottokratie entscheidet… {regionLabel(field, lotterySelected)}</div>}
        {winner !== null && winner !== "tie" && winner !== "empty" && <div className="outcome outcome-majority">Mehrheit: {winner}</div>}
        {winner === "empty" && <div className="outcome outcome-empty" />}
      </div>
    );
  }

  const counts =
    countSource !== null && isTwoQuadrantCounts(countSource) ? countSource : null;
  const positions = TWO_QUADRANT_POSITIONS[field.axis];
  return (
    <div
      className={`quadrant-overlay quadrant-overlay-two-quadrant quadrant-overlay-axis-${field.axis}`}
    >
      <Axis axis={field.axis} labels={field.labels} />
      {field.variant !== "split"
        ? <div className={`axis-track axis-track-${field.axis}`} aria-hidden>
            {field.axis === "x" ? <><span className="axis-arrow axis-arrow-left" /><span className="axis-arrow axis-arrow-right" /></> : <><span className="axis-arrow axis-arrow-top" /><span className="axis-arrow axis-arrow-bottom" /></>}
          </div>
        : <div className={`axis-divider axis-divider-${field.axis}`} aria-hidden />}
      {(["min", "max"] as const).map((id) => (
        <Region
          key={id}
          id={id}
          position={positions[id]}
          count={showCounts ? counts?.[id] ?? null : null}
          winner={winner}
          highlight={highlighted.includes(id)}
        />
      ))}
      {winner === "tie" && lotterySelected === null && <div className="outcome outcome-tie">Gleichstand</div>}
      {lotterySelected !== null && <div className="outcome outcome-kleroterion">Lottokratie entscheidet… {regionLabel(field, lotterySelected)}</div>}
      {winner !== null && winner !== "tie" && winner !== "empty" && <div className="outcome outcome-majority">Mehrheit: {winner === "min" ? field.labels.minLabel : field.labels.maxLabel}</div>}
      {winner === "empty" && <div className="outcome outcome-empty" />}
    </div>
  );
}
