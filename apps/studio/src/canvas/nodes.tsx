import { useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import type { StudioProject } from "@smartphonecracy/studio-adapter";

type NodeData = {
  label: string;
  kind: string;
  outcomes?: Array<{ id: string; label: string; tone: "quad" | "special" }>;
};
type Phase = StudioProject["scenario"]["phases"][number];

const KIND_TITLE: Record<string, string> = { idle: "Idle", video: "Video", "position-question": "Question" };

const InPort = () => (
  <div className="port port-in"><Handle aria-label="Input" className="sc-tool-graph-port" id="input" type="target" position={Position.Left} /><span className="port-name">in</span></div>
);
const OutPort = ({ id, label, tone }: { id: string; label: string; tone?: "quad" | "special" }) => (
  <div className={`port port-out ${tone ?? ""}`} data-port-tone={tone ?? "default"}><span className="port-name">{label}</span><Handle aria-label={`${label} output`} className="sc-tool-graph-port" id={id} type="source" position={Position.Right} /></div>
);

export function nodeDataForPhase(phase: Phase): NodeData {
  const data: NodeData = {
    label: phase.kind === "position-question" ? phase.text : phase.id,
    kind: phase.kind,
  };
  if (phase.kind !== "position-question" || phase.next.type !== "quadrant-plurality") return data;
  if (phase.field.type === "four-quadrant") {
    data.outcomes = [
      { id: "q1", label: "q1 · top right", tone: "quad" },
      { id: "q2", label: "q2 · top left", tone: "quad" },
      { id: "q3", label: "q3 · bottom left", tone: "quad" },
      { id: "q4", label: "q4 · bottom right / center", tone: "quad" },
      { id: "tie", label: "tie", tone: "special" },
      { id: "empty", label: "no votes", tone: "special" },
    ];
    return data;
  }
  const [minPosition, maxPosition] = phase.field.axis === "x"
    ? (["left", "right"] as const)
    : (["top", "bottom"] as const);
  data.outcomes = [
    { id: "min", label: `min · ${minPosition} · ${phase.field.labels.minLabel}`, tone: "quad" },
    { id: "max", label: `max · ${maxPosition} · ${phase.field.labels.maxLabel}`, tone: "quad" },
    { id: "tie", label: "tie", tone: "special" },
    { id: "empty", label: "no votes", tone: "special" },
  ];
  return data;
}

export function PhaseNode({ id, data, dragging, selected }: NodeProps) {
  const value = data as NodeData;
  const updateNodeInternals = useUpdateNodeInternals();
  const outputSignature = value.outcomes?.map((outcome) => outcome.id).join(":") ?? (value.kind === "idle" ? "" : "next");
  useEffect(() => updateNodeInternals(id), [id, outputSignature, updateNodeInternals]);
  const outputs = value.outcomes
    ? value.outcomes.map(({ id, label, tone }) => <OutPort key={id} id={id} label={label} tone={tone} />)
    : value.kind !== "idle" ? [<OutPort key="next" id="next" label="next" />] : [];
  return (
    <div className={`studio-node sc-tool-graph-node kind-${value.kind}`} data-sc-tool-domain={value.kind === "position-question" ? "question" : value.kind} data-sc-tool-dragging={dragging} data-selected={selected}>
      <div className="node-head">{KIND_TITLE[value.kind] ?? value.kind}</div>
      <div className="node-body"><div className="node-title">{value.label}</div></div>
      <div className="node-io">
        <InPort />
        {outputs.length > 0 && <div className="ports-out">{outputs}</div>}
      </div>
    </div>
  );
}

export function EntryNode() {
  return <div className="studio-node sc-tool-graph-node marker kind-entry" data-sc-tool-domain="entry"><div className="node-head">Entry</div><div className="node-io"><div className="ports-out"><OutPort id="next" label="start" /></div></div></div>;
}
export function EndNode() {
  return <div className="studio-node sc-tool-graph-node marker kind-end" data-sc-tool-domain="idle"><div className="node-head">End</div><div className="node-body"><div className="node-title muted">returns to idle / attract</div></div><div className="node-io"><InPort /></div></div>;
}

export const nodeTypes = { phase: PhaseNode, entry: EntryNode, end: EndNode };
