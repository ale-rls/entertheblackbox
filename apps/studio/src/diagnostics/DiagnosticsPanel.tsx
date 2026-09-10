import type { StudioProject } from "@smartphonecracy/studio-adapter";
import { branchMediaBudgets, mediaRows } from "../media/library.js";
import { diagnosticKey, diagnostics, exportBlocked } from "./diagnostics.js";

export function DiagnosticsPanel({ project, acknowledged, collapsed, onAcknowledge, onAcknowledgeAll, onFocus, onToggle }: { project: StudioProject; acknowledged: Set<string>; collapsed: boolean; onAcknowledge: (key: string) => void; onAcknowledgeAll: (keys: readonly string[]) => void; onFocus: (id: string) => void; onToggle: () => void }) {
  const items = diagnostics(project); const rows = mediaRows(project);
  const errorCount = items.filter((item) => item.severity === "error").length;
  const acknowledgementKeys = items.filter((item) => item.acknowledgementRequired).map(diagnosticKey);
  const hasUnacknowledged = acknowledgementKeys.some((key) => !acknowledged.has(key));
  return <section className={`diagnostics${collapsed ? " is-collapsed" : ""}`} aria-labelledby="bottom-panel-heading">
    <header className="diagnostics-header">
      <h2 id="bottom-panel-heading">Diagnostics &amp; media</h2>
      <span className="diagnostics-summary">{errorCount ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : "No errors"}</span>
      <button className="sc-tool-button diagnostics-toggle" data-sc-tool-variant="quiet" type="button" aria-controls="bottom-panel-content" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "Expand panel" : "Collapse panel"}</button>
    </header>
    <div id="bottom-panel-content" className="diagnostics-content" hidden={collapsed}>
      <h3>Media</h3><table><thead><tr><th>File / ID</th><th>Bytes</th><th>Hash</th><th>Used by</th></tr></thead><tbody>{rows.map((row) => <tr key={row.src}><td>{row.src}</td><td>{row.bytes.toLocaleString()}</td><td><code>{row.hash.slice(0, 12)}…</code></td><td>{row.references.join(", ") || "Unused"}</td></tr>)}</tbody></table>
      {project.scenario.phases.filter((phase) => phase.kind === "position-question" || phase.kind === "video-position-question").map((phase) => <details key={phase.id}><summary>Branch media budget: {phase.id}</summary>{Object.entries(branchMediaBudgets(project, phase.id)).map(([key, bytes]) => <span key={key}>{key}: {bytes.toLocaleString()} bytes<br /></span>)}</details>)}
      <div className="diagnostics-list-heading">
        <h3>Diagnostics {exportBlocked(items, acknowledged) && <small>— export blocked</small>}</h3>
        <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!hasUnacknowledged} onClick={() => onAcknowledgeAll(acknowledgementKeys)}>Acknowledge all</button>
      </div>
      <ul>{items.map((item) => { const key = diagnosticKey(item); return <li key={key} className={item.severity}><strong>{item.severity}</strong> {item.message} {item.phaseId && <button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => onFocus(item.phaseId!)}>Focus node</button>} {item.acknowledgementRequired && <label className="sc-tool-checkbox"><input type="checkbox" checked={acknowledged.has(key)} onChange={() => onAcknowledge(key)} /> Acknowledge</label>}</li>; })}</ul>
    </div>
  </section>;
}
