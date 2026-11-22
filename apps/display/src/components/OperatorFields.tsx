import type { OperatorFields as OperatorFieldsConfig } from "@entertheblackbox/scenario";

const LIT_DEFAULT = "#fff4e0";

/** The operator-field counter as the script writes it, on the main display and M1–M4. */
export function checkpointText(count: number, total: number, label = "Checkpoints"): string {
  return `${label}: ${count}/${total}`;
}

/**
 * Fields the operator lights one at a time (e.g. the hack's target field): the lit field glows in
 * its colour, the others stay faintly outlined so the four areas read as one layout. An optional
 * counter shows the operator's steps ("Checkpoints: 3/12").
 */
export function OperatorFields({ fields, state }: { fields: OperatorFieldsConfig; state: { target: string | null; count: number } | undefined }) {
  const target = state?.target ?? null;
  return <div className="operator-fields" aria-hidden="true">
    <svg viewBox="0 0 1 1" preserveAspectRatio="none">
      <defs><filter id="operator-field-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.012" /></filter></defs>
      {fields.zones.map((zone) => {
        const lit = zone.id === target;
        const color = zone.color ?? LIT_DEFAULT;
        const points = zone.points.map((point) => `${point.x},${point.y}`).join(" ");
        return <g key={zone.id} data-zone={zone.id} data-lit={lit}>
          {lit && <polygon points={points} fill={color} opacity={0.5} filter="url(#operator-field-glow)" />}
          <polygon points={points} fill={color} fillOpacity={lit ? 0.35 : 0.06} stroke={color} strokeOpacity={lit ? 0.95 : 0.3} strokeWidth={lit ? 0.006 : 0.003} vectorEffect="non-scaling-stroke" />
        </g>;
      })}
    </svg>
    {fields.total !== undefined && <div className="operator-fields-count">{checkpointText(state?.count ?? 0, fields.total, fields.counterLabel)}</div>}
  </div>;
}
