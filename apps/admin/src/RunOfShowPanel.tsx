import { useState } from "react";

const QR_FILENAME = "enter-the-blackbox-join-qr.png";

export function RunOfShowPanel({ phoneJoinUrl }: { phoneJoinUrl: string | null }) {
  const [exportState, setExportState] = useState<"idle" | "working" | "done" | "error">("idle");

  const downloadQrCode = async () => {
    if (!phoneJoinUrl || exportState === "working") return;
    setExportState("working");
    try {
      const { default: QRCode } = await import("qrcode");
      const png = await QRCode.toDataURL(phoneJoinUrl, {
        type: "image/png",
        width: 1024,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      const link = document.createElement("a");
      link.href = png;
      link.download = QR_FILENAME;
      document.body.append(link);
      link.click();
      link.remove();
      setExportState("done");
    } catch {
      setExportState("error");
    }
  };

  return <section className="sc-tool-panel run-of-show" aria-labelledby="run-of-show-heading">
    <div className="admin-section-heading"><h2 id="run-of-show-heading">Run of show</h2></div>
    <nav className="run-of-show-links" aria-label="Show tools">
      <a href="/studio/">Studio &amp; shows</a>
      <a href="/admin/?view=audio">Audio diagnostics</a>
      <a href="/phone/" target="_blank" rel="noreferrer">Test phone</a>
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!phoneJoinUrl || exportState === "working"} onClick={() => void downloadQrCode()}>
        {exportState === "working" ? "Generating PNG…" : "Download join QR (PNG)"}
      </button>
    </nav>
    <p className="sc-tool-help">Open the display using the installation’s configured link. Audience phones join using its QR code. The PNG export contains the same configured phone link.</p>
    {(exportState === "done" || exportState === "error" || !phoneJoinUrl) && <p className="sc-tool-help" aria-live="polite">
      {exportState === "done" ? `Downloaded ${QR_FILENAME}.` : exportState === "error" ? "The QR code could not be exported. Try again." : "The phone join URL is not configured."}
    </p>}
  </section>;
}
