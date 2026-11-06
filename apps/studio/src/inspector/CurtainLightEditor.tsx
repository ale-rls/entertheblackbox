import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildPoolMasks,
  composeLightMap,
  CURTAIN_DEFAULTS,
  CURTAIN_DEFAULT_NEUTRAL_GAP,
  curtainLabels,
  curtainVoteField,
  cursorTint,
  hexToLinear,
  neutralEntryPoint,
  poolIntensities,
  quadrantOfField,
  resolveAnswerColors,
  resolveCurtainSettings,
  type PositionField,
} from "../../../../packages/shared/src/index.js";
import type { CurtainLightConfig, CurtainLightingTuning, Scenario } from "../../../../packages/scenario/src/index.js";
import type { Phase } from "./model.js";

type VotePhase = Extract<Phase, { kind: "position-question" | "video-position-question" }>;

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function Slider({ label, hint, value, min, max, step, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  return <label className="sc-tool-label curtain-slider"><span title={hint}>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(event) => onChange(round(Number(event.currentTarget.value)))} />
    <output>{value.toFixed(2)}</output>
  </label>;
}

function answerLabels(field: PositionField): Record<string, string> {
  if (field.type === "polygon-zones") return Object.fromEntries(field.zones.map((zone) => [zone.id, zone.label]));
  if (field.type === "two-quadrant") return { min: field.labels.minLabel, max: field.labels.maxLabel };
  return {
    q1: `${field.xAxis.maxLabel} / ${field.yAxis.minLabel}`,
    q2: `${field.xAxis.minLabel} / ${field.yAxis.minLabel}`,
    q3: `${field.xAxis.minLabel} / ${field.yAxis.maxLabel}`,
    q4: `${field.xAxis.maxLabel} / ${field.yAxis.maxLabel}`,
  };
}

const LIGHTING_FIELDS: Array<{ key: keyof CurtainLightingTuning; label: string; hint: string; max: number }> = [
  { key: "poolBase", label: "Pool glow with no votes", hint: "poolBase", max: 3 },
  { key: "poolGain", label: "Extra glow for a full share", hint: "poolGain", max: 4 },
  { key: "cursorFlood", label: "Cursor light, neutral", hint: "cursorFlood", max: 2 },
  { key: "cursorFloodCounted", label: "Cursor light, counting", hint: "cursorFloodCounted", max: 2 },
];

/**
 * The shared curtain, configured once for every curtain-light group. The
 * video comes from the media library and is published with the show.
 */
export function CurtainSharedEditor({ config, mediaSources, onChange }: {
  config: CurtainLightConfig | undefined;
  mediaSources: string[];
  onChange: (config: CurtainLightConfig | undefined) => void;
}) {
  const settings = resolveCurtainSettings(config);
  const set = (patch: Partial<CurtainLightConfig>) => {
    const next = Object.fromEntries(Object.entries({ ...config, ...patch }).filter(([, value]) => value !== undefined)) as CurtainLightConfig;
    onChange(Object.keys(next).length === 0 ? undefined : next);
  };
  const videos = [...new Set([...mediaSources.filter((src) => /\.mp4$/i.test(src)), ...(config?.src ? [config.src] : [])])].sort();
  return <fieldset className="curtain-shared"><legend>Shared curtain <small>curtainLight</small></legend>
    <label className="sc-tool-label"><span title="curtainLight.src">Curtain video</span>
      <select className="sc-tool-select" value={config?.src ?? ""} onChange={(event) => set({ src: event.target.value || undefined })}>
        <option value="">Choose a packed curtain video…</option>
        {videos.map((src) => <option key={src} value={src}>{src}</option>)}
      </select>
    </label>
    <p className="sc-tool-copy field-hint">Default fabric: {CURTAIN_DEFAULTS.fabric}. Upload the packed clip (colour, normal X, normal Y, depth) to the media library; it is published with the show and never stored in git.</p>
    <details><summary>Fabric and light tuning</summary>
      <Slider label="Original picture" hint="curtainLight.baked" value={settings.baked} min={0} max={1} step={0.01} onChange={(baked) => set({ baked })} />
      <Slider label="Fold depth" hint="curtainLight.folds" value={settings.folds} min={0} max={3} step={0.05} onChange={(folds) => set({ folds })} />
      <Slider label="Satin sheen" hint="curtainLight.shine" value={settings.shine} min={0} max={3} step={0.05} onChange={(shine) => set({ shine })} />
      <Slider label="Fold shadows" hint="curtainLight.shadow" value={settings.shadow} min={0} max={1} step={0.01} onChange={(shadow) => set({ shadow })} />
      <Slider label="Default neutral gap" hint="curtainLight.neutralGap" value={settings.neutralGap} min={0} max={0.4} step={0.005} onChange={(neutralGap) => set({ neutralGap })} />
      {LIGHTING_FIELDS.map((item) => <Slider key={item.key} label={item.label} hint={`curtainLight.${item.hint}`} value={settings[item.key]} min={0} max={item.max} step={0.05} onChange={(value) => set({ [item.key]: value })} />)}
      <button className="sc-tool-button" type="button" onClick={() => onChange(config?.src ? { src: config.src } : undefined)}>Reset tuning to defaults</button>
    </details>
  </fieldset>;
}

/** Per-stage curtain-light authoring: answer colours, a live preview, and rehearsal tuning. */
export function CurtainStageEditor({ phase, scenario, onChange }: {
  phase: VotePhase;
  scenario: Pick<Scenario, "curtainLight">;
  onChange: (phase: Phase) => void;
}) {
  const settings = resolveCurtainSettings(scenario.curtainLight, phase.lightTuning);
  // Stable identities keep the preview animation running across unrelated re-renders.
  const fieldKey = JSON.stringify([phase.field, settings.neutralGap]);
  const field = useMemo(() => curtainVoteField(phase.field, settings.neutralGap), [fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const colorKey = JSON.stringify([fieldKey, phase.answerColors]);
  const colors = useMemo(() => resolveAnswerColors(field, phase.answerColors), [colorKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = answerLabels(field);
  const setColor = (id: string, color: string) => onChange({ ...phase, answerColors: { ...phase.answerColors, [id]: color } } as Phase);
  const setTuning = (patch: Partial<CurtainLightingTuning>) => {
    const next = Object.fromEntries(Object.entries({ ...phase.lightTuning, ...patch }).filter(([, value]) => value !== undefined));
    onChange({ ...phase, lightTuning: Object.keys(next).length === 0 ? undefined : next } as Phase);
  };
  const gapField = phase.field.type === "polygon-zones" ? null : phase.field;
  return <fieldset className="curtain-stage"><legend>Curtain light</legend>
    <CurtainPreview field={field} colors={colors} settings={settings} question={phase.text} />
    <div className="curtain-colors">
      {Object.entries(colors).map(([id, color]) => <label key={id} className="sc-tool-label curtain-color">
        <input type="color" value={color} aria-label={`Colour for ${labels[id] ?? id}`} onChange={(event) => setColor(id, event.target.value)} />
        <span title={`answerColors.${id}`}>{labels[id] ?? id}</span>
      </label>)}
    </div>
    <button className="sc-tool-button" type="button" disabled={phase.answerColors === undefined} onClick={() => onChange({ ...phase, answerColors: undefined } as Phase)}>Reset colours to system defaults</button>
    <details><summary>Rehearsal tuning</summary>
      {gapField && <Slider label="Neutral gap" hint="field.neutralGap" value={gapField.neutralGap ?? settings.neutralGap} min={0} max={0.4} step={0.005}
        onChange={(neutralGap) => onChange({ ...phase, field: { ...gapField, neutralGap } } as Phase)} />}
      {gapField === null && <p className="sc-tool-copy field-hint">Custom zones: the space between zones is the neutral gap.</p>}
      {LIGHTING_FIELDS.map((item) => <Slider key={item.key} label={item.label} hint={`lightTuning.${item.hint}`} value={settings[item.key]} min={0} max={item.max} step={0.05} onChange={(value) => setTuning({ [item.key]: value })} />)}
      <button className="sc-tool-button" type="button" disabled={phase.lightTuning === undefined && gapField?.neutralGap === undefined}
        onClick={() => onChange({ ...phase, lightTuning: undefined, ...(gapField ? { field: { ...gapField, neutralGap: undefined } } : {}) } as Phase)}>Use shared curtain settings</button>
      <p className="sc-tool-copy field-hint">Default gap is {CURTAIN_DEFAULT_NEUTRAL_GAP} of the screen unless the shared curtain changes it.</p>
    </details>
  </fieldset>;
}

type SampleCursor = { x: number; y: number; vx: number; vy: number; target: { x: number; y: number } };

/**
 * A light-only preview: pools from the same counting geometry the server
 * uses, sample cursor lights, and a simulated distribution that drives pool
 * brightness the way live counts do. The fabric itself is only drawn on the
 * display, so this shows layout, colour and balance rather than final looks.
 */
export function CurtainPreview({ field, colors, settings, question }: {
  field: PositionField;
  colors: Record<string, string>;
  settings: ReturnType<typeof resolveCurtainSettings>;
  question: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [count, setCount] = useState(16);
  const [lean, setLean] = useState("even");
  const [running, setRunning] = useState(true);
  const pools = useMemo(() => buildPoolMasks(field, 96, 54), [field]);
  const labels = useMemo(() => curtainLabels(field, pools), [field, pools]);
  const entry = useMemo(() => neutralEntryPoint(field), [field]);
  const colorsLinear = useMemo(() => pools.outcomes.map((id) => hexToLinear(colors[id] ?? "#ffffff")), [pools, colors]);
  const live = useRef({ settings, lean, running, count });
  live.current = { settings, lean, running, count };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const map = document.createElement("canvas");
    map.width = pools.columns;
    map.height = pools.rows;
    const mapCtx = map.getContext("2d")!;
    const image = mapCtx.createImageData(pools.columns, pools.rows);
    const intensities = pools.outcomes.map(() => settings.poolBase);
    const start = entry ?? { x: 0.5, y: 0.5 };
    const centers = pools.outcomes.map((id) => pools.centers[id] ?? start);
    const targetFor = (index: number) => {
      const choice = live.current.lean === "even"
        ? centers[index % centers.length]!
        : index % 3 === 0 ? centers[(index / 3) % centers.length | 0]! : centers[Math.max(0, pools.outcomes.indexOf(live.current.lean))]!;
      return { x: choice.x + (Math.sin(index * 12.9) * 0.08), y: choice.y + (Math.cos(index * 7.3) * 0.08) };
    };
    const cursors: SampleCursor[] = [];
    let raf = 0;
    let last = performance.now();
    let pulseAt = new Map<number, number>();
    const draw = (time: number) => {
      const elapsed = Math.min(100, time - last);
      last = time;
      const { settings: s, running: go, count: wanted } = live.current;
      while (cursors.length < wanted) cursors.push({ x: start.x, y: start.y, vx: 0, vy: 0, target: targetFor(cursors.length) });
      cursors.length = Math.min(cursors.length, wanted);
      cursors.forEach((cursor, index) => {
        cursor.target = targetFor(index);
        if (!go) return;
        cursor.vx = cursor.vx * 0.9 + (cursor.target.x - cursor.x) * 0.004 * elapsed / 16;
        cursor.vy = cursor.vy * 0.9 + (cursor.target.y - cursor.y) * 0.004 * elapsed / 16;
        cursor.x = Math.min(1, Math.max(0, cursor.x + cursor.vx));
        cursor.y = Math.min(1, Math.max(0, cursor.y + cursor.vy));
        if (Math.random() < elapsed / 4000) pulseAt.set(index, time);
      });
      const counts: Record<string, number> = {};
      for (const cursor of cursors) {
        const outcome = quadrantOfField(field, cursor.x, cursor.y);
        if (outcome !== null) counts[outcome] = (counts[outcome] ?? 0) + 1;
      }
      const targets = poolIntensities(pools.outcomes, counts, s);
      const k = 1 - Math.exp(-elapsed / 320);
      targets.forEach((target, i) => { intensities[i] = intensities[i]! + (target - intensities[i]!) * k; });
      const light = composeLightMap(pools, colorsLinear, intensities);
      for (let cell = 0; cell < pools.columns * pools.rows; cell += 1) {
        for (let c = 0; c < 3; c += 1) {
          const v = light[cell * 3 + c]! * 0.55;
          image.data[cell * 4 + c] = Math.round(255 * Math.min(1, (1 - Math.exp(-v * 1.6)) ** (1 / 2.2)));
        }
        image.data[cell * 4 + 3] = 255;
      }
      mapCtx.putImageData(image, 0, 0);
      const { width, height } = canvas;
      ctx.fillStyle = "#0b0b0d";
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(map, 0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      cursors.forEach((cursor, index) => {
        const tint = cursorTint(pools, colorsLinear, cursor.x, cursor.y);
        const counted = quadrantOfField(field, cursor.x, cursor.y) !== null;
        const pulse = pulseAt.has(index) ? Math.exp(-(time - pulseAt.get(index)!) / 380) : 0;
        const rgb = tint.rgb.map((v) => Math.round(255 * v ** (1 / 2.2))).join(" ");
        const x = cursor.x * width;
        const y = cursor.y * height;
        const flood = (counted ? s.cursorFloodCounted : s.cursorFlood) * (1 + 0.6 * pulse);
        const radius = height * 0.15;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgb(${rgb} / ${Math.min(1, 0.35 * flood)})`);
        gradient.addColorStop(1, `rgb(${rgb} / 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.beginPath(); ctx.arc(x, y, height * 0.012 * (1 + 1.2 * pulse), 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgb(255 255 255 / 90%)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `500 ${Math.round(width * 0.042)}px system-ui, sans-serif`;
      ctx.fillText(question, width / 2, height * 0.09, width * 0.88);
      ctx.font = `500 ${Math.round(width * 0.03)}px system-ui, sans-serif`;
      for (const label of labels) ctx.fillText(label.text, label.x * width, label.y * height, width * 0.24);
      if (entry) {
        ctx.strokeStyle = "rgb(255 255 255 / 45%)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(entry.x * width, entry.y * height, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (pulseAt.size > 64) pulseAt = new Map();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [field, pools, labels, entry, colorsLinear, question]);

  return <div className="curtain-preview">
    <canvas ref={canvasRef} width={384} height={216} aria-label="Curtain light preview" />
    <div className="curtain-preview-controls">
      <label className="sc-tool-label"><span>Sample cursors</span><input type="range" min="0" max="30" value={count} aria-label="Sample cursors" onChange={(event) => setCount(Number(event.currentTarget.value))} /><output>{count}</output></label>
      <label className="sc-tool-label"><span>Simulated vote</span><select className="sc-tool-select" value={lean} onChange={(event) => setLean(event.target.value)}>
        <option value="even">Spread evenly</option>
        {pools.outcomes.map((id) => <option key={id} value={id}>Lean toward {id}</option>)}
      </select></label>
      <button className="sc-tool-button" type="button" onClick={() => setRunning(!running)}>{running ? "Pause" : "Play"}</button>
    </div>
    {entry === null && <p className="sc-tool-copy field-hint" role="alert">No neutral space: cursors would vote as they appear. Leave a gap between answer areas.</p>}
    <p className="sc-tool-copy field-hint">Dashed ring: where cursors appear on first touch. The display adds the fabric.</p>
  </div>;
}
