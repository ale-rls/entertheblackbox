import { useEffect, useState } from "react";

const QR_FILENAME = "enter-the-blackbox-join-qr.png";

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function RunOfShowPanel({ phoneJoinUrl }: { phoneJoinUrl: string | null }) {
  const [exportUrl, setExportUrl] = useState(phoneJoinUrl ?? "");
  const [exportState, setExportState] = useState<"idle" | "working" | "done" | "error">("idle");
  const normalizedExportUrl = exportUrl.trim();
  const exportUrlIsValid = isWebUrl(normalizedExportUrl);

  useEffect(() => {
    setExportUrl(phoneJoinUrl ?? "");
    setExportState("idle");
  }, [phoneJoinUrl]);

  const downloadQrCode = async () => {
    if (!exportUrlIsValid || exportState === "working") return;
    setExportState("working");
    try {
      const { default: QRCode } = await import("qrcode");
      const png = await QRCode.toDataURL(normalizedExportUrl, {
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
    </nav>
    <div className="admin-qr-export">
      <label className="sc-tool-label" htmlFor="admin-qr-export-url">QR code destination URL
        <input id="admin-qr-export-url" className="sc-tool-field" type="url" inputMode="url" value={exportUrl} aria-invalid={exportUrl.length > 0 && !exportUrlIsValid} onChange={(event) => {
          setExportUrl(event.target.value);
          setExportState("idle");
        }} />
      </label>
      <div className="admin-qr-export-actions">
        <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={!exportUrlIsValid || exportState === "working"} onClick={() => void downloadQrCode()}>
          {exportState === "working" ? "Generating PNG…" : "Download join QR (PNG)"}
        </button>
        {phoneJoinUrl && <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={exportUrl === phoneJoinUrl || exportState === "working"} onClick={() => {
          setExportUrl(phoneJoinUrl);
          setExportState("idle");
        }}>Use configured URL</button>}
      </div>
    </div>
    <p className="sc-tool-help">The field starts with the installation’s configured phone link. An override affects only the downloaded PNG; it does not change the live display or saved settings.</p>
    {(exportState === "done" || exportState === "error" || !exportUrlIsValid) && <p className="sc-tool-help" aria-live="polite">
      {exportState === "done" ? `Downloaded ${QR_FILENAME}.` : exportState === "error" ? "The QR code could not be exported. Try again." : exportUrl.length > 0 ? "Enter a valid HTTP or HTTPS URL." : "Enter a URL to export a QR code."}
    </p>}
  </section>;
}
