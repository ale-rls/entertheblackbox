import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { branchMediaBudgets, mediaRows } from "../media/library.js";
import { diagnosticKey, diagnostics, exportBlocked } from "./diagnostics.js";

export function DiagnosticsPanel({ project, acknowledged, onAcknowledge, onFocus }: { project: StudioProject; acknowledged: Set<string>; onAcknowledge: (key: string) => void; onFocus: (id: string) => void }) {
  const items = diagnostics(project); const rows = mediaRows(project);
  return <section className="diagnostics" aria-label="Validation and media">
    <h2>Media</h2><table><thead><tr><th>File / ID</th><th>Bytes</th><th>Hash</th><th>Used by</th></tr></thead><tbody>{rows.map((row) => <tr key={row.src}><td>{row.src}</td><td>{row.bytes.toLocaleString()}</td><td><code>{row.hash.slice(0, 12)}…</code></td><td>{row.references.join(", ") || "Unused"}</td></tr>)}</tbody></table>
    {project.scenario.phases.filter((phase) => phase.kind === "position-question").map((phase) => <details key={phase.id}><summary>Branch media budget: {phase.id}</summary>{Object.entries(branchMediaBudgets(project, phase.id)).map(([key, bytes]) => <span key={key}>{key}: {bytes.toLocaleString()} bytes<br /></span>)}</details>)}
    <h2>Diagnostics {exportBlocked(items, acknowledged) && <small>— export blocked</small>}</h2>
    <ul>{items.map((item) => { const key = diagnosticKey(item); return <li key={key} className={item.severity}><strong>{item.severity}</strong> {item.message} {item.phaseId && <button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => onFocus(item.phaseId!)}>Focus node</button>} {item.acknowledgementRequired && <label className="sc-tool-checkbox"><input type="checkbox" checked={acknowledged.has(key)} onChange={() => onAcknowledge(key)} /> Acknowledge</label>}</li>; })}</ul>
  </section>;
}
