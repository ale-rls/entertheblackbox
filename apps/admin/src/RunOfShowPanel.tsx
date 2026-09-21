export function RunOfShowPanel() {
  return <section className="sc-tool-panel run-of-show" aria-labelledby="run-of-show-heading">
    <div className="admin-section-heading"><h2 id="run-of-show-heading">Run of show</h2></div>
    <nav className="run-of-show-links" aria-label="Show tools">
      <a href="/studio/">Studio &amp; shows</a>
      <a href="/admin/?view=audio">Audio diagnostics</a>
      <a href="/phone/" target="_blank" rel="noreferrer">Test phone</a>
    </nav>
    <p className="sc-tool-help">Open the display using the installation’s configured link. Audience phones join using its QR code.</p>
  </section>;
}
