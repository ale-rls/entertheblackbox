import { StatusIcon, type ToolStatus } from "@smartphonecracy/tool-ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";

function Status({ status, children }: { status: ToolStatus; children: ReactNode }) {
  return <span className="sc-tool-status" data-sc-tool-status={status}><StatusIcon status={status} /><span>{children}</span></span>;
}

function Button({ children, variant = "secondary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return <button className="sc-tool-button" data-sc-tool-variant={variant} type="button" {...props}>{children}</button>;
}

function GraphNode({ domain, title, kind, className, selected = false, output }: {
  domain: "entry" | "idle" | "video" | "question";
  title: string;
  kind: string;
  className: string;
  selected?: boolean;
  output?: string;
}) {
  return <article aria-label={`${title}, ${kind}`} aria-selected={selected} className={`sc-tool-graph-node studio-proof-node ${className}`} data-sc-tool-domain={domain} role="option" tabIndex={0}>
    <span className="studio-proof-node-kind">{kind}</span><strong>{title}</strong>
    {output && <span className="studio-proof-node-output sc-tool-mono">{output}</span>}
    <span aria-hidden="true" className="sc-tool-graph-port studio-proof-node-port" />
  </article>;
}

export function StudioProof() {
  return <div data-sc-tool-density="compact" data-sc-tool-root>
    <main className="studio-proof" data-testid="studio-proof">
      <header className="studio-proof-toolbar">
        <div className="studio-proof-brand"><span className="sc-tool-eyebrow">Show Studio</span><strong>Assembly / Opening night</strong></div>
        <nav className="studio-proof-menus" aria-label="Application menu">
          {(["File", "Edit", "View", "Add"] as const).map((menu) => <button aria-haspopup="menu" className="sc-tool-button studio-proof-menu-trigger" data-sc-tool-variant="quiet" key={menu} type="button">{menu}</button>)}
        </nav>
        <div className="studio-proof-document-state" aria-live="polite">
          <Status status="success">Saved</Status><span className="sc-tool-mono">14:31:52</span><Status status="warning">Export blocked</Status><Button variant="primary">Preview show</Button>
        </div>
      </header>

      <div className="studio-proof-workbench">
        <section className="studio-proof-canvas sc-tool-graph-canvas" aria-labelledby="studio-canvas-title" tabIndex={0}>
          <header className="studio-proof-canvas-heading">
            <div><p className="sc-tool-eyebrow">Scenario graph</p><h1 id="studio-canvas-title">Opening night</h1></div>
            <div className="studio-proof-canvas-tools" aria-label="Canvas controls"><Button aria-label="Zoom out" variant="quiet">−</Button><span className="sc-tool-mono">82%</span><Button aria-label="Zoom in" variant="quiet">+</Button><Button variant="quiet">Fit graph</Button></div>
          </header>

          <div className="studio-proof-graph-stage" aria-label="Show phase graph" role="listbox">
            <svg aria-hidden="true" className="studio-proof-graph-edges" viewBox="0 0 900 550">
              <path className="sc-tool-graph-edge" data-sc-tool-edge="active" d="M151 84 C220 84 205 202 274 202" />
              <path className="sc-tool-graph-edge" data-sc-tool-edge="active" d="M422 202 C495 202 478 100 552 100" />
              <path className="sc-tool-graph-edge" data-sc-tool-edge="branch" d="M702 100 C772 100 756 230 827 230" />
              <path className="sc-tool-graph-edge" data-sc-tool-edge="branch" d="M702 100 C756 100 506 337 566 337" />
              <path className="sc-tool-graph-edge" d="M716 337 C780 337 764 275 827 275" />
            </svg>
            <GraphNode className="studio-proof-node-entry" domain="entry" kind="Entry" output="start" title="Show entry" />
            <GraphNode className="studio-proof-node-welcome" domain="video" kind="Video" output="next" title="welcome-loop" />
            <GraphNode className="studio-proof-node-question" domain="question" kind="Position question" output="q1 · q2 · q3 · q4 · tie · empty" selected title="question-02" />
            <GraphNode className="studio-proof-node-result" domain="video" kind="Video" output="next" title="result-north" />
            <GraphNode className="studio-proof-node-end" domain="idle" kind="End" title="returns to idle / attract" />
          </div>
        </section>

        <aside className="studio-proof-inspector" aria-labelledby="studio-inspector-title">
          <header className="studio-proof-inspector-heading">
            <div><p className="sc-tool-eyebrow">Selected node</p><h2 id="studio-inspector-title">Properties</h2></div>
            <span className="studio-proof-node-type">Question</span>
          </header>
          <div className="studio-proof-inspector-content">
            <div className="sc-tool-field-group">
              <label className="sc-tool-label">Runtime ID <span className="sc-tool-mono">id</span><input className="sc-tool-field sc-tool-mono" defaultValue="question-02" /></label>
              <label className="sc-tool-label">Phase type <span className="sc-tool-mono">kind</span><select className="sc-tool-select" defaultValue="position-question"><option value="video">Video</option><option value="position-question">Position question</option></select></label>
              <label className="sc-tool-label">Question <span className="sc-tool-mono">text</span><input className="sc-tool-field" defaultValue="Where should the city invest next?" /></label>
              <label className="sc-tool-label">Quadrant layout <span className="sc-tool-mono">field.type</span><select className="sc-tool-select" defaultValue="four-quadrant"><option value="four-quadrant">Four quadrants · X + Y axes</option><option value="two-quadrant-x">Two quadrants · left / right</option><option value="two-quadrant-y">Two quadrants · top / bottom</option></select></label>
            </div>
            <div className="sc-tool-field-group">
              <div className="studio-proof-axis-fields">
                <label className="sc-tool-label">X axis minimum<input className="sc-tool-field" defaultValue="Repair" /></label>
                <label className="sc-tool-label">X axis maximum<input className="sc-tool-field" defaultValue="Reimagine" /></label>
              </div>
              <label className="sc-tool-label">Question duration (ms) <span className="sc-tool-mono">durationMs</span><input className="sc-tool-field sc-tool-mono" defaultValue="45000" min="0" type="number" /></label>
              <label className="sc-tool-checkbox"><input defaultChecked type="checkbox" />Show live quadrant counts</label>
            </div>
            <Status status="warning">1 transition needs review</Status>
          </div>
        </aside>

        <section className="studio-proof-diagnostics" aria-labelledby="studio-diagnostics-title">
          <header>
            <div><p className="sc-tool-eyebrow">Validation and media</p><h2 id="studio-diagnostics-title">Diagnostics <span className="sc-tool-mono">3</span></h2></div>
            <Button variant="quiet">Collapse</Button>
          </header>
          <div className="studio-proof-diagnostic-rows">
            <article className="studio-proof-diagnostic-row"><StatusIcon status="danger" /><strong className="sc-tool-mono">missing-transition</strong><span>The empty outcome has no target.</span><button className="sc-tool-button" data-sc-tool-variant="quiet" type="button">Focus question-02</button></article>
            <article className="studio-proof-diagnostic-row"><StatusIcon status="warning" /><strong className="sc-tool-mono">unused-media</strong><span>intro-alt.mp4 is not referenced.</span><button className="sc-tool-button" data-sc-tool-variant="quiet" type="button">Open media</button></article>
            <article className="studio-proof-diagnostic-row"><StatusIcon status="info" /><strong className="sc-tool-mono">media-budget</strong><span>620 MB of 2 GB deployment budget used.</span><span className="sc-tool-mono">31%</span></article>
          </div>
        </section>
      </div>
    </main>
  </div>;
}
