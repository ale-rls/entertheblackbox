import type { CSSProperties } from "react";
import type { StudioProject } from "@entertheblackbox/studio-adapter";
import type { PositionField } from "../../../../packages/shared/src/index.js";
import { sceneScreens, type Screen, type ScreenLayer, type ScreenOption } from "./screens.js";

const fileName = (src: string) => src.split("/").pop() ?? src;
const FIELD_ORDER = { "four-quadrant": [["q2", 0, 0], ["q1", 0.5, 0], ["q3", 0, 0.5], ["q4", 0.5, 0.5]] } as const;

function Field({ field, colors, curtain }: { field: PositionField; colors: Record<string, string>; curtain: boolean }) {
  const fill = (id: string) => colors[id] ?? "currentColor";
  const opacity = curtain ? 0.55 : 0.28;
  let regions;
  if (field.type === "polygon-zones") {
    regions = field.zones.map((zone) => <polygon key={zone.id} points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={fill(zone.id)} fillOpacity={opacity} stroke={fill(zone.id)} strokeWidth={0.01} />);
  } else if (field.type === "four-quadrant") {
    regions = FIELD_ORDER["four-quadrant"].map(([id, x, y]) => <rect key={id} x={x} y={y} width={0.5} height={0.5} fill={fill(id)} fillOpacity={opacity} />);
  } else {
    const split = field.axis === "x" ? field.splitX ?? 0.5 : 0.5;
    regions = field.axis === "x"
      ? [<rect key="min" x={0} y={0} width={split} height={1} fill={fill("min")} fillOpacity={opacity} />, <rect key="max" x={split} y={0} width={1 - split} height={1} fill={fill("max")} fillOpacity={opacity} />]
      : [<rect key="min" x={0} y={0} width={1} height={0.5} fill={fill("min")} fillOpacity={opacity} />, <rect key="max" x={0} y={0.5} width={1} height={0.5} fill={fill("max")} fillOpacity={opacity} />];
  }
  return <svg className={`minimap-field${curtain ? " curtain" : ""}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
    {curtain && <defs><filter id="minimap-curtain-blur"><feGaussianBlur stdDeviation="0.06" /></filter></defs>}
    <g filter={curtain ? "url(#minimap-curtain-blur)" : undefined}>{regions}</g>
  </svg>;
}

function Buttons({ options }: { options: ScreenOption[] }) {
  return <div className="minimap-buttons">{options.map((option, index) => <span key={index} title={option.label} style={option.color ? { "--minimap-option": option.color } as CSSProperties : undefined} />)}</div>;
}

const CURSORS = [[0.22, 0.62], [0.41, 0.34], [0.68, 0.7], [0.8, 0.28], [0.55, 0.52]];

function Layer({ layer }: { layer: ScreenLayer }) {
  switch (layer.kind) {
    case "video": return <div className="minimap-media video" title={`Video: ${fileName(layer.src)}${layer.loop ? " (loop)" : ""}`}><span className="minimap-play" /></div>;
    case "image": return <div className="minimap-media image" title={`Image: ${fileName(layer.src)}`}><span className="minimap-mountain" /></div>;
    case "attract": return <div className="minimap-media video" title="Idle attract loop"><span className="minimap-play" /></div>;
    case "title": return <p className="minimap-title" title={layer.text}>{layer.text}</p>;
    case "text": return <p className="minimap-text" title={layer.text} style={layer.color ? { color: layer.color } : undefined}>{layer.text}</p>;
    case "placeholder": return <p className="minimap-placeholder" title={`Placeholder: ${layer.text}`}>{layer.text}</p>;
    case "subtitles": return <span className="minimap-subtitles" title="Subtitles" />;
    case "qr": return <span className="minimap-qr" title="Join QR" />;
    case "field": return <Field field={layer.field} colors={layer.colors} curtain={layer.curtain} />;
    case "cursors": return <div className="minimap-cursors" title="Audience cursors">{CURSORS.map(([x, y], index) => <span key={index} style={{ left: `${x! * 100}%`, top: `${y! * 100}%` }} />)}</div>;
    case "rating": return <div className="minimap-rating" title="Applause / boo"><span className="applause" /><span className="boo" /></div>;
    case "cursor-pad": return <div className="minimap-pad" title="Cursor pad"><span /></div>;
    case "buttons": return <Buttons options={layer.options} />;
    case "script": return <div className="minimap-script" title={layer.lines.join("\n")}>{layer.lines.slice(0, 8).map((line, index) => <span key={index} style={{ width: `${Math.min(100, 25 + line.length * 2)}%` }} />)}</div>;
    case "task": return <div className="minimap-task" title={`Task: ${layer.title}`}><span /><span /><span /></div>;
    case "audio": return <div className="minimap-audio" title="Phone audio">{[0.4, 0.8, 0.55, 1, 0.65, 0.35, 0.75].map((height, index) => <span key={index} style={{ height: `${height * 100}%` }} />)}</div>;
  }
}

function MiniScreen({ screen }: { screen: Screen }) {
  const empty = screen.layers.length === 0;
  return <figure className={`minimap-screen ${screen.orientation} minimap-${screen.id}`} data-empty={empty}>
    <div className="minimap-glass" aria-label={`${screen.label}: ${empty ? "nothing shown" : screen.layers.map((layer) => layer.kind).join(", ")}`}>
      <div className="minimap-stack">{screen.layers.map((layer, index) => <Layer key={index} layer={layer} />)}</div>
      {screen.cueCount !== undefined && <span className="minimap-cues" title={`${screen.cueCount} cues; showing the first`}>{Array.from({ length: Math.min(screen.cueCount, 6) }, (_, index) => <i key={index} />)}</span>}
    </div>
    <figcaption>{screen.label}</figcaption>
  </figure>;
}

/** Bottom-left canvas overlay: what the selected scene puts on every screen. */
export function ScreenMinimap({ project, selectedId }: { project: StudioProject; selectedId: string | undefined }) {
  const scene = sceneScreens(project, selectedId);
  if (!scene) return null;
  const byId = Object.fromEntries(scene.screens.map((screen) => [screen.id, screen]));
  return <aside className="screen-minimap" aria-label={`Screens for ${scene.phaseId}`}>
    <div className="minimap-row">
      <MiniScreen screen={byId.main!} />
      <MiniScreen screen={byId.app!} />
    </div>
    <div className="minimap-row">
      {(["M1", "M2", "M3", "M4"] as const).map((id) => <MiniScreen key={id} screen={byId[id]!} />)}
      <MiniScreen screen={byId.web!} />
    </div>
  </aside>;
}
