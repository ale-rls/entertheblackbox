import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type ConfirmationDetails = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger" | "primary";
  trigger: HTMLElement | null;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmationDialog({ details, onClose }: { details: ConfirmationDetails; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [working, setWorking] = useState(false);
  const titleId = "studio-confirmation-title";
  const descriptionId = "studio-confirmation-description";

  useEffect(() => { cancelRef.current?.focus(); }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !working) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const applyConfirmation = async () => {
    setWorking(true);
    try {
      await details.onConfirm();
      onClose();
    } finally {
      setWorking(false);
    }
  };

  return <div className="sc-tool-dialog-scrim" onMouseDown={(event) => {
    if (!working && event.target === event.currentTarget) onClose();
  }}>
    <div className="sc-tool-dialog studio-confirmation" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={handleKeyDown}>
      <p className="sc-tool-eyebrow">Confirm change</p>
      <h2 id={titleId}>{details.title}</h2>
      <p id={descriptionId}>{details.description}</p>
      <div className="sc-tool-dialog-actions">
        <button ref={cancelRef} className="sc-tool-button" data-sc-tool-variant="secondary" type="button" disabled={working} onClick={onClose}>{details.cancelLabel}</button>
        <button className="sc-tool-button" data-sc-tool-variant={details.tone} type="button" disabled={working} onClick={() => void applyConfirmation()}>{working ? "Applying…" : details.confirmLabel}</button>
      </div>
    </div>
  </div>;
}
