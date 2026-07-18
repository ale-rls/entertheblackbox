import { StatusIcon, type ToolStatus } from "@smartphonecracy/tool-ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";

function Status({ status, children }: { status: ToolStatus; children: ReactNode }) {
  return <span className="sc-tool-status" data-sc-tool-status={status}><StatusIcon status={status} /><span>{children}</span></span>;
}

function Button({ children, variant = "secondary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return <button className="sc-tool-button" data-sc-tool-variant={variant} type="button" {...props}>{children}</button>;
}

function OperationRow({ label, status, value, detail }: { label: string; status: ToolStatus; value: string; detail: string }) {
  return <div className="admin-proof-operation-row">
    <div className="admin-proof-operation-label"><StatusIcon status={status} /><span>{label}</span></div>
    <strong className="sc-tool-mono">{value}</strong><span>{detail}</span>
  </div>;
}

export function AdminProof() {
  return <div data-sc-tool-density="standard" data-sc-tool-root>
    <main className="admin-proof" data-testid="admin-proof">
      <header className="admin-proof-header">
        <div><p className="sc-tool-eyebrow">Live installation / operator console</p><h1>Operations</h1></div>
        <div className="admin-proof-global-state"><Status status="success">System nominal</Status><span className="sc-tool-mono">14:32:08 CET</span></div>
      </header>

      <section className="sc-tool-panel admin-proof-connection" aria-labelledby="admin-connection-heading">
        <div className="admin-proof-section-heading">
          <div><p className="sc-tool-eyebrow">Secure access</p><h2 id="admin-connection-heading">Admin connection</h2></div>
          <Status status="success">Authenticated</Status>
        </div>
        <div className="admin-proof-connection-form">
          <label className="sc-tool-label">Admin token<input className="sc-tool-field sc-tool-mono" defaultValue="••••••••••••••••••••••••" type="password" /></label>
          <Button variant="primary">Connect</Button>
        </div>
        <p className="sc-tool-help">Token is held for this browser session only. Last verified 18 seconds ago.</p>
      </section>

      <div className="admin-proof-grid">
        <section className="sc-tool-panel" aria-labelledby="admin-status-heading">
          <div className="admin-proof-section-heading">
            <div><p className="sc-tool-eyebrow">Live topology</p><h2 id="admin-status-heading">Operational status</h2></div>
            <span className="sc-tool-mono admin-proof-section-count">4 services</span>
          </div>
          <div className="admin-proof-operation-list">
            <OperationRow label="Server" status="success" value="ONLINE" detail="uptime 03:18:42" />
            <OperationRow label="Display" status="success" value="CONNECTED" detail="heartbeat 42 ms ago" />
            <OperationRow label="Participants" status="info" value="118 / 160" detail="3 stale · 1 disconnected" />
            <OperationRow label="Session" status="success" value="ACTIVE" detail="session 5H7D-A2" />
          </div>
        </section>

        <section className="sc-tool-panel" aria-labelledby="admin-controls-heading">
          <div className="admin-proof-section-heading">
            <div><p className="sc-tool-eyebrow">Session 5H7D-A2</p><h2 id="admin-controls-heading">Session controls</h2></div>
            <Status status="success">Active</Status>
          </div>
          <dl className="admin-proof-session-facts">
            <div><dt>Current phase</dt><dd className="sc-tool-mono">question-02</dd></div>
            <div><dt>Epoch</dt><dd className="sc-tool-mono">7</dd></div>
            <div><dt>Elapsed</dt><dd className="sc-tool-mono">00:12:48</dd></div>
          </dl>
          <div className="admin-proof-button-row">
            <Button disabled>Start show</Button>
            <Button variant="primary">Skip current phase</Button>
            <Button>Restart show</Button>
            <Button variant="danger">Return to idle</Button>
          </div>
          <p className="sc-tool-help">Start is unavailable while a show is active. Skip resolves the current question using its latest participant positions.</p>
        </section>

      </div>
    </main>
  </div>;
}
